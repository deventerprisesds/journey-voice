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
    console.log('=== EMBA SYNC START ===');
    
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

    // Support demo/preview mode: allow explicit or fallback user_id
    let requestBody: any = null;
    try { 
      requestBody = await req.json(); 
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
    } catch { 
      console.log('No request body provided');
    }
    
    const requestUserId = requestBody?.userId as string | undefined;
    const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
    const userId = user?.id ?? requestUserId ?? DEMO_USER_ID;

    console.log('Authenticated user:', user?.id ?? 'NONE');
    console.log('Effective userId:', userId);
    console.log('Demo mode:', !user?.id);

    // Get EMBA sheet config
    console.log('=== FETCHING SYNC CONFIG ===');
    console.log('Query params:', { user_id: userId, service_type: 'google_sheets' });
    
    const { data: configs, error: configError } = await supabaseClient
      .from('sync_config')
      .select('*')
      .eq('user_id', userId)
      .eq('service_type', 'google_sheets');

    if (configError) {
      console.error('Config query error:', configError);
      throw configError;
    }

    console.log('Configs found:', configs?.length ?? 0);
    console.log('Full configs:', JSON.stringify(configs, null, 2));

    const config = configs?.[0];
    
    // Try new structure first: config_data.emba_sheet_url
    let embaSheetUrl = config?.config_data?.emba_sheet_url;
    let urlSource = 'new (emba_sheet_url)';
    
    // Fallback to legacy structure: sheet_type === 'emba'
    if (!embaSheetUrl) {
      const legacyConfig = configs?.find(c => c.config_data?.sheet_type === 'emba');
      embaSheetUrl = legacyConfig?.config_data?.sheet_url;
      urlSource = 'legacy (sheet_type=emba)';
    }

    console.log('EMBA sheet URL:', embaSheetUrl ?? 'NONE');
    console.log('URL source:', embaSheetUrl ? urlSource : 'N/A');

    if (!embaSheetUrl) {
      throw new Error('EMBA sheet URL not configured');
    }

    // Create sync log entry
    console.log('=== CREATING SYNC LOG ===');
    const { data: syncLog, error: logError } = await supabaseClient
      .from('sync_logs')
      .insert({
        user_id: userId,
        service_type: 'google_sheets',
        sync_type: 'emba_assignments',
        status: 'in_progress',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (logError) {
      console.error('Sync log creation error:', logError);
      throw logError;
    }
    console.log('Sync log created:', syncLog.id);

    try {
      // Extract sheet ID and gid from URL
      console.log('=== PARSING SHEET URL ===');
      const sheetUrl = embaSheetUrl;
      const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      const gidMatch = sheetUrl.match(/[#&]gid=([0-9]+)/);
      
      if (!sheetIdMatch) {
        throw new Error('Invalid sheet URL format');
      }

      const sheetId = sheetIdMatch[1];
      const gid = gidMatch ? gidMatch[1] : '0';
      console.log('Sheet ID:', sheetId);
      console.log('GID:', gid);

      // Fetch sheet data as CSV
      console.log('=== FETCHING CSV DATA ===');
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      console.log('CSV URL:', csvUrl);
      
      const csvResponse = await fetch(csvUrl);
      const csvText = await csvResponse.text();
      console.log('CSV fetched, length:', csvText.length);

      // Parse CSV (simple parsing - assumes well-formed CSV)
      console.log('=== PARSING CSV ===');
      const lines = csvText.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      console.log('Headers found:', headers);
      
      // Find column indexes
      const titleIdx = headers.findIndex(h => h.toLowerCase().includes('title') || h.toLowerCase().includes('assignment'));
      const descIdx = headers.findIndex(h => h.toLowerCase().includes('description') || h.toLowerCase().includes('details'));
      const dueDateIdx = headers.findIndex(h => h.toLowerCase().includes('due'));
      const courseIdx = headers.findIndex(h => h.toLowerCase().includes('course'));
      const priorityIdx = headers.findIndex(h => h.toLowerCase().includes('priority'));
      const pointsIdx = headers.findIndex(h => h.toLowerCase().includes('points'));

      console.log('Column mappings:', { titleIdx, descIdx, dueDateIdx, courseIdx, priorityIdx, pointsIdx });
      console.log('Total rows to process:', lines.length - 1);

      // Get course weekend date from class_schedules (EMBA specific logic)
      console.log('=== FETCHING NEXT WEEKEND DATE ===');
      const { data: schedules } = await supabaseClient
        .from('class_schedules')
        .select('date')
        .eq('user_id', userId)
        .gte('date', new Date().toISOString())
        .order('date', { ascending: true })
        .limit(1);

      const nextWeekendDate = schedules?.[0]?.date ? new Date(schedules[0].date) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      console.log('Next weekend date:', nextWeekendDate.toISOString());

      let processed = 0;
      let added = 0;
      let updated = 0;
      const assignmentIds: string[] = [];

      // Process each row
      console.log('=== PROCESSING ROWS ===');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        
        const title = cols[titleIdx] || `Assignment ${i}`;
        const description = descIdx >= 0 ? cols[descIdx] : '';
        const dueDateStr = dueDateIdx >= 0 ? cols[dueDateIdx] : '';
        const courseName = courseIdx >= 0 ? cols[courseIdx] : '';
        const priority = priorityIdx >= 0 ? cols[priorityIdx]?.toLowerCase() : 'medium';
        const points = pointsIdx >= 0 ? parseInt(cols[pointsIdx]) : null;

        console.log(`--- Row ${i}/${lines.length - 1} ---`);
        console.log('Title:', title);
        console.log('Course:', courseName);
        console.log('Due date string:', dueDateStr);

        // Parse due date
        let dueDate = null;
        if (dueDateStr) {
          const parsed = new Date(dueDateStr);
          if (!isNaN(parsed.getTime())) {
            dueDate = parsed.toISOString();
            console.log('Parsed due date:', dueDate);
          }
        }

        // Filter: only include assignments due before next weekend
        if (dueDate && new Date(dueDate) > nextWeekendDate) {
          console.log('Skipping - due after next weekend');
          continue;
        }

        processed++;

        // Find or create course
        let courseId = null;
        if (courseName) {
          console.log('Looking up course:', courseName);
          const { data: existingCourse } = await supabaseClient
            .from('courses')
            .select('id')
            .eq('user_id', userId)
            .eq('name', courseName)
            .maybeSingle();

          if (existingCourse) {
            courseId = existingCourse.id;
            console.log('Found existing course:', courseId);
          } else {
            console.log('Creating new course');
            const { data: newCourse } = await supabaseClient
              .from('courses')
              .insert({
                user_id: userId,
                name: courseName,
                color: '#3B82F6'
              })
              .select('id')
              .single();
            
            if (newCourse) {
              courseId = newCourse.id;
              console.log('Created course:', courseId);
            }
          }
        }

        // Check if assignment exists
        console.log('Checking for existing assignment at row:', i);
        const { data: existing } = await supabaseClient
          .from('assignments')
          .select('id')
          .eq('user_id', userId)
          .eq('sheet_row_number', i)
          .maybeSingle();

        if (existing) {
          console.log('Updating existing assignment:', existing.id);
          await supabaseClient
            .from('assignments')
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
          console.log('Inserting new assignment');
          const { data: newAssignment } = await supabaseClient
            .from('assignments')
            .insert({
              user_id: userId,
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
            console.log('Created assignment:', newAssignment.id);
          }
        }
      }

      // Update sync log
      console.log('=== UPDATING SYNC LOG ===');
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

      console.log('=== EMBA SYNC COMPLETE ===');
      console.log('Processed:', processed);
      console.log('Added:', added);
      console.log('Updated:', updated);
      console.log('Assignment IDs:', assignmentIds);

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
      console.error('=== SYNC ERROR ===');
      console.error('Error details:', error);
      
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
    console.error('=== FATAL ERROR IN SYNC-GOOGLE-SHEETS ===');
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});