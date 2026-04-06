import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Parse a single CSV line respecting quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Robust date parser — returns ISO string or null */
function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  const monthNameMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (monthNameMatch) {
    const d = new Date(`${monthNameMatch[1]} ${monthNameMatch[2]}, ${monthNameMatch[3]}`);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString();
  }

  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}T00:00:00Z`);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString();
  }

  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = parseInt(slashMatch[3]);
    if (year < 100) year += 2000;
    if (year >= 2020) {
      const d = new Date(year, parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  const fallback = new Date(s);
  if (!isNaN(fallback.getTime()) && fallback.getFullYear() >= 2020) {
    return fallback.toISOString();
  }

  console.warn(`Unparseable date: "${s}"`);
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== MIT SYNC START ===');
    
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
    } catch {}
    
    const requestUserId = requestBody?.userId as string | undefined;
    const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
    const userId = user?.id ?? requestUserId ?? DEMO_USER_ID;

    console.log('Effective userId:', userId);

    // Get MIT sheet config
    const { data: configs, error: configError } = await supabaseClient
      .from('sync_config')
      .select('*')
      .eq('user_id', userId)
      .eq('service_type', 'google_sheets');

    if (configError) throw configError;

    const config = configs?.[0];
    let mitSheetUrl = config?.config_data?.mit_sheet_url;
    if (!mitSheetUrl) {
      const legacyConfig = configs?.find(c => c.config_data?.sheet_type === 'mit');
      mitSheetUrl = legacyConfig?.config_data?.sheet_url;
    }

    if (!mitSheetUrl) {
      return new Response(
        JSON.stringify({ error: 'MIT sheet URL not configured.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create sync log
    const { data: syncLog, error: logError } = await supabaseClient
      .from('sync_logs')
      .insert({
        user_id: userId,
        service_type: 'mit_sheets',
        sync_type: 'mit_assignments',
        status: 'in_progress',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (logError) throw logError;

    try {
      const sheetIdMatch = mitSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      const gidMatch = mitSheetUrl.match(/[#&]gid=([0-9]+)/);
      if (!sheetIdMatch) throw new Error('Invalid sheet URL format');

      const sheetId = sheetIdMatch[1];
      const gid = gidMatch ? gidMatch[1] : '0';

      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      const csvResponse = await fetch(csvUrl);
      const csvText = await csvResponse.text();
      console.log('CSV fetched, length:', csvText.length);

      const lines = csvText.split('\n');
      const headers = parseCSVLine(lines[0]);
      
      const titleIdx = headers.findIndex(h => h.toLowerCase().includes('title') || h.toLowerCase().includes('assignment'));
      const descIdx = headers.findIndex(h => h.toLowerCase().includes('description') || h.toLowerCase().includes('details'));
      const dueDateIdx = headers.findIndex(h => h.toLowerCase().includes('due'));
      const courseIdx = headers.findIndex(h => h.toLowerCase().includes('course'));
      const priorityIdx = headers.findIndex(h => h.toLowerCase().includes('priority'));
      const pointsIdx = headers.findIndex(h => h.toLowerCase().includes('points'));
      const linkIdx = headers.findIndex(h => h.toLowerCase().includes('link') || h.toLowerCase().includes('url'));

      console.log('Column mappings:', { titleIdx, descIdx, dueDateIdx, courseIdx, priorityIdx, pointsIdx, linkIdx });

      let processed = 0;
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      const assignmentIds: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCSVLine(line);
        
        const title = (titleIdx >= 0 ? cols[titleIdx] : '') || '';
        const description = descIdx >= 0 ? (cols[descIdx] || '') : '';
        const dueDateStr = dueDateIdx >= 0 ? (cols[dueDateIdx] || '') : '';
        const courseName = courseIdx >= 0 ? (cols[courseIdx] || '') : '';
        const priority = priorityIdx >= 0 ? (cols[priorityIdx]?.toLowerCase() || 'medium') : 'medium';
        const points = pointsIdx >= 0 ? parseInt(cols[pointsIdx]) : null;
        const assignmentUrl = linkIdx >= 0 ? (cols[linkIdx] || '') : '';

        if (title.toLowerCase().includes('office hour')) continue;
        if (!title) continue;

        const dueDate = parseDate(dueDateStr);

        processed++;

        // Find or create MIT course
        let courseId = null;
        if (courseName) {
          const mitCourseName = courseName.startsWith('MIT:') ? courseName : `MIT: ${courseName}`;
          
          const { data: existingCourse } = await adminClient
            .from('courses')
            .select('id')
            .eq('user_id', userId)
            .eq('name', mitCourseName)
            .limit(1)
            .maybeSingle();

          if (existingCourse) {
            courseId = existingCourse.id;
          } else {
            const { data: newCourse } = await adminClient
              .from('courses')
              .insert({ user_id: userId, name: mitCourseName, color: '#8B5CF6' })
              .select('id')
              .single();
            if (newCourse) courseId = newCourse.id;
          }
        }

        // Check existing by sheet_row_number — use limit(1) to handle dupes safely
        const { data: existingRows } = await adminClient
          .from('assignments_mit')
          .select('id, title, due_date, description, priority, points')
          .eq('user_id', userId)
          .eq('sheet_row_number', i)
          .limit(1);

        const existing = existingRows?.[0] || null;

        if (existing) {
          const existingDue = existing.due_date ? new Date(existing.due_date).toISOString() : null;
          const hasChanges = existing.title !== title ||
            existingDue !== dueDate ||
            (existing.description || '') !== (description || '') ||
            (existing.priority || 'medium') !== (priority || 'medium');

          if (hasChanges) {
            await adminClient
              .from('assignments_mit')
              .update({
                title,
                description,
                due_date: dueDate,
                course_id: courseId,
                priority: priority as any,
                points,
                assignment_url: assignmentUrl || null,
                updated_at: new Date().toISOString()
              })
              .eq('id', existing.id);
            updated++;
            console.log(`Updated row ${i}: "${title}" due=${dueDate}`);
          } else {
            unchanged++;
          }
          assignmentIds.push(existing.id);
        } else {
          const { data: newAssignment } = await adminClient
            .from('assignments_mit')
            .insert({
              user_id: userId,
              title,
              description,
              due_date: dueDate,
              course_id: courseId,
              priority: priority as any,
              points,
              assignment_url: assignmentUrl || null,
              sheet_row_number: i,
              type: 'assignment',
              status: 'active'
            })
            .select('id')
            .single();

          if (newAssignment) {
            added++;
            assignmentIds.push(newAssignment.id);
            console.log(`Added row ${i}: "${title}" due=${dueDate}`);
          }
        }
      }

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

      console.log(`=== MIT SYNC COMPLETE: ${processed} processed, ${added} added, ${updated} updated, ${unchanged} unchanged ===`);

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
