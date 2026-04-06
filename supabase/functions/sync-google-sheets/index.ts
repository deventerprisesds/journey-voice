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
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user } } = await supabaseClient.auth.getUser();

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
    const DEMO_MODE = !user?.id || userId === DEMO_USER_ID;
    const DEV_EMBA_USER_ID = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';
    const writeUserId = DEMO_MODE ? DEMO_USER_ID : userId;

    console.log('Effective userId:', userId);
    console.log('Write User ID:', writeUserId);

    // Get EMBA sheet config
    const { data: configs, error: configError } = await supabaseClient
      .from('sync_config')
      .select('*')
      .eq('user_id', userId)
      .eq('service_type', 'google_sheets');

    if (configError) throw configError;

    const config = configs?.[0];
    let embaSheetUrl = config?.config_data?.emba_sheet_url;
    if (!embaSheetUrl) {
      const legacyConfig = configs?.find(c => c.config_data?.sheet_type === 'emba');
      embaSheetUrl = legacyConfig?.config_data?.sheet_url;
    }

    if (!embaSheetUrl) {
      return new Response(
        JSON.stringify({ error: 'EMBA sheet URL not configured. Please add your EMBA sheet URL in Settings first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create sync log
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

    if (logError) throw logError;

    try {
      // Parse sheet URL
      const sheetIdMatch = embaSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      const gidMatch = embaSheetUrl.match(/[#&]gid=([0-9]+)/);
      if (!sheetIdMatch) throw new Error('Invalid sheet URL format');

      const sheetId = sheetIdMatch[1];
      const configuredGid = config?.config_data?.emba_sheet_gid;
      const gid = configuredGid ? String(configuredGid) : (gidMatch ? gidMatch[1] : '0');

      // Fetch CSV
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      const csvResponse = await fetch(csvUrl);
      const csvText = await csvResponse.text();
      console.log('CSV fetched, length:', csvText.length);

      const lines = csvText.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      const titleIdx = headers.findIndex(h => h.toLowerCase().includes('title') || h.toLowerCase().includes('assignment'));
      const descIdx = headers.findIndex(h => h.toLowerCase().includes('description') || h.toLowerCase().includes('details'));
      const dueDateIdx = headers.findIndex(h => h.toLowerCase().includes('due'));
      const courseIdx = headers.findIndex(h => h.toLowerCase().includes('course'));
      const priorityIdx = headers.findIndex(h => h.toLowerCase().includes('priority'));
      const pointsIdx = headers.findIndex(h => h.toLowerCase().includes('points'));
      const linkIdx = headers.findIndex(h => h.toLowerCase().includes('link') || h.toLowerCase().includes('url'));

      console.log('Column mappings:', { titleIdx, descIdx, dueDateIdx, courseIdx, priorityIdx, pointsIdx, linkIdx });
      console.log('Total rows:', lines.length - 1);

      // Get program_id for EMBA
      const { data: embaProgram } = await adminClient
        .from('programs')
        .select('id')
        .or(`name.ilike.%emba%,name.ilike.%executive%`)
        .limit(1)
        .maybeSingle();

      let processed = 0;
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      const assignmentIds: string[] = [];

      // Process ALL rows — no time-window filter
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
        const assignmentUrl = linkIdx >= 0 ? (cols[linkIdx] || '') : '';

        // Skip rows with no title
        if (!title || title === `Assignment ${i}`) {
          continue;
        }

        // Parse due date
        let dueDate = null;
        if (dueDateStr) {
          const parsed = new Date(dueDateStr);
          if (!isNaN(parsed.getTime())) {
            dueDate = parsed.toISOString();
          }
        }

        processed++;

        // Find or create course
        let courseId = null;
        if (courseName) {
          const { data: existingCourse } = await adminClient
            .from('courses')
            .select('id')
            .eq('user_id', writeUserId)
            .eq('name', courseName)
            .maybeSingle();

          if (existingCourse) {
            courseId = existingCourse.id;
          } else {
            const { data: newCourse } = await adminClient
              .from('courses')
              .insert({ user_id: writeUserId, name: courseName, color: '#3B82F6' })
              .select('id')
              .single();
            if (newCourse) courseId = newCourse.id;
          }
        }

        // Check existing by sheet_row_number
        const { data: existing } = await adminClient
          .from('assignments')
          .select('id, title, due_date, description, priority, points, assignment_url')
          .eq('user_id', writeUserId)
          .eq('sheet_row_number', i)
          .maybeSingle();

        if (existing) {
          // Check if anything changed
          const existingDue = existing.due_date ? new Date(existing.due_date).toISOString() : null;
          const hasChanges = existing.title !== title ||
            existingDue !== dueDate ||
            (existing.description || '') !== (description || '') ||
            (existing.priority || 'medium') !== (priority || 'medium');

          if (hasChanges) {
            await adminClient
              .from('assignments')
              .update({
                title,
                description,
                due_date: dueDate,
                course_id: courseId,
                priority: priority as any,
                points,
                assignment_url: assignmentUrl || null,
                program_id: embaProgram?.id || null,
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id);
            updated++;
            console.log(`Updated row ${i}: "${title}"`);
          } else {
            unchanged++;
          }
          assignmentIds.push(existing.id);
        } else {
          const { data: newAssignment } = await adminClient
            .from('assignments')
            .insert({
              user_id: writeUserId,
              title,
              description,
              due_date: dueDate,
              course_id: courseId,
              priority: priority as any,
              points,
              assignment_url: assignmentUrl || null,
              sheet_row_number: i,
              type: 'assignment',
              status: 'active',
              program_id: embaProgram?.id || null,
            })
            .select('id')
            .single();

          if (newAssignment) {
            added++;
            assignmentIds.push(newAssignment.id);
            console.log(`Added row ${i}: "${title}"`);
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

      console.log(`=== EMBA SYNC COMPLETE: ${processed} processed, ${added} added, ${updated} updated, ${unchanged} unchanged ===`);

      return new Response(
        JSON.stringify({ success: true, processed, added, updated, unchanged, assignmentIds }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error: any) {
      console.error('SYNC ERROR:', error);
      await supabaseClient
        .from('sync_logs')
        .update({ status: 'failed', completed_at: new Date().toISOString(), error_message: error.message })
        .eq('id', syncLog.id);
      throw error;
    }

  } catch (error: any) {
    console.error('FATAL ERROR:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
