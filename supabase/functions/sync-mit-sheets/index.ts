import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    console.log('Syncing MIT assignments for user:', user.id);

    // Get MIT sheet config
    const { data: configs, error: configError } = await supabaseClient
      .from('sync_config')
      .select('*')
      .eq('user_id', user.id)
      .eq('service_type', 'google_sheets');

    if (configError) throw configError;

    const mitConfig = configs?.find(c => c.config_data?.sheet_type === 'mit');
    if (!mitConfig || !mitConfig.config_data?.sheet_url) {
      throw new Error('MIT sheet URL not configured');
    }

    // Create sync log entry
    const { data: syncLog, error: logError } = await supabaseClient
      .from('sync_logs')
      .insert({
        user_id: user.id,
        service_type: 'mit_sheets',
        sync_type: 'mit_assignments',
        status: 'in_progress',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (logError) throw logError;

    try {
      // Extract sheet ID and gid from URL
      const sheetUrl = mitConfig.config_data.sheet_url;
      const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);
      
      if (!sheetIdMatch) {
        throw new Error('Invalid sheet URL format');
      }

      const sheetId = sheetIdMatch[1];
      const gid = gidMatch ? gidMatch[1] : '0';

      // Fetch sheet data as CSV
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      const csvResponse = await fetch(csvUrl);
      const csvText = await csvResponse.text();

      // Parse CSV
      const lines = csvText.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      // Find column indexes
      const titleIdx = headers.findIndex(h => h.toLowerCase().includes('title') || h.toLowerCase().includes('assignment'));
      const descIdx = headers.findIndex(h => h.toLowerCase().includes('description') || h.toLowerCase().includes('details'));
      const dueDateIdx = headers.findIndex(h => h.toLowerCase().includes('due'));
      const courseIdx = headers.findIndex(h => h.toLowerCase().includes('course'));
      const priorityIdx = headers.findIndex(h => h.toLowerCase().includes('priority'));
      const pointsIdx = headers.findIndex(h => h.toLowerCase().includes('points'));

      console.log('MIT Column indexes:', { titleIdx, descIdx, dueDateIdx, courseIdx, priorityIdx, pointsIdx });

      // MIT filter: next 14 days
      const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      let processed = 0;
      let added = 0;
      let updated = 0;
      const assignmentIds: string[] = [];

      // Process each row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        
        const title = cols[titleIdx] || `MIT Assignment ${i}`;
        const description = descIdx >= 0 ? cols[descIdx] : '';
        const dueDateStr = dueDateIdx >= 0 ? cols[dueDateIdx] : '';
        const courseName = courseIdx >= 0 ? cols[courseIdx] : '';
        const priority = priorityIdx >= 0 ? cols[priorityIdx]?.toLowerCase() : 'medium';
        const points = pointsIdx >= 0 ? parseInt(cols[pointsIdx]) : null;

        // Parse due date
        let dueDate = null;
        if (dueDateStr) {
          const parsed = new Date(dueDateStr);
          if (!isNaN(parsed.getTime())) {
            dueDate = parsed.toISOString();
          }
        }

        // Filter: only include assignments due within next 14 days
        if (!dueDate || new Date(dueDate) > twoWeeksFromNow || new Date(dueDate) < new Date()) {
          continue;
        }

        processed++;

        // Find or create MIT course (prefix with "MIT: ")
        let courseId = null;
        if (courseName) {
          const mitCourseName = courseName.startsWith('MIT:') ? courseName : `MIT: ${courseName}`;
          
          const { data: existingCourse } = await supabaseClient
            .from('courses')
            .select('id')
            .eq('user_id', user.id)
            .eq('name', mitCourseName)
            .maybeSingle();

          if (existingCourse) {
            courseId = existingCourse.id;
          } else {
            const { data: newCourse } = await supabaseClient
              .from('courses')
              .insert({
                user_id: user.id,
                name: mitCourseName,
                color: '#8B5CF6' // Purple for MIT
              })
              .select('id')
              .single();
            
            if (newCourse) courseId = newCourse.id;
          }
        }

        // Check if assignment exists in assignments_mit
        const { data: existing } = await supabaseClient
          .from('assignments_mit')
          .select('id')
          .eq('user_id', user.id)
          .eq('sheet_row_number', i)
          .maybeSingle();

        if (existing) {
          // Update existing
          await supabaseClient
            .from('assignments_mit')
            .update({
              title,
              description,
              due_date: dueDate,
              course_id: courseId,
              priority: priority as any,
              points,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
          
          updated++;
          assignmentIds.push(existing.id);
        } else {
          // Insert new
          const { data: newAssignment } = await supabaseClient
            .from('assignments_mit')
            .insert({
              user_id: user.id,
              title,
              description,
              due_date: dueDate,
              course_id: courseId,
              priority: priority as any,
              points,
              sheet_row_number: i,
              type: 'assignment',
              status: 'active'
            })
            .select('id')
            .single();

          if (newAssignment) {
            added++;
            assignmentIds.push(newAssignment.id);
          }
        }
      }

      // Update sync log
      await supabaseClient
        .from('sync_logs')
        .update({
          status: 'success',
          completed_at: new Date().toISOString(),
          records_processed: processed,
          records_added: added,
          records_updated: updated
        })
        .eq('id', syncLog.id);

      console.log(`MIT sync complete: Processed ${processed}, Added ${added}, Updated ${updated}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed, 
          added, 
          updated, 
          assignmentIds 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      // Log error
      await supabaseClient
        .from('sync_logs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message
        })
        .eq('id', syncLog.id);

      throw error;
    }

  } catch (error: any) {
    console.error('Error in sync-mit-sheets:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
