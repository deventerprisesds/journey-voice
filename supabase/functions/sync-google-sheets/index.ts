import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { fetchNexusAssignments, createNexusAssignment, updateNexusAssignment, nexusWritesConfigured } from "../_shared/nexus.ts";

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
          i++; // skip escaped quote
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

  // Month D, YYYY (e.g. "April 5, 2025")
  const monthNameMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (monthNameMatch) {
    const d = new Date(`${monthNameMatch[1]} ${monthNameMatch[2]}, ${monthNameMatch[3]}`);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString();
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}T00:00:00Z`);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d.toISOString();
  }

  // M/D/YYYY or M/D/YY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    let year = parseInt(slashMatch[3]);
    if (year < 100) year += 2000;
    if (year >= 2020) {
      const d = new Date(year, parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  // Last resort: native parse with sanity check
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
      const headers = parseCSVLine(lines[0]);
      
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
      // Refuse to run without the write credential. Previously these wrote Supabase, so
      // "no token" would otherwise mean a clean-looking sync that persists nothing.
      if (!nexusWritesConfigured()) {
        console.error('[EMBA_SHEETS] UAT_BYPASS_TOKEN missing — refusing to sync.');
        return new Response(JSON.stringify({
          success: false,
          error: 'Nexus writes are not configured (UAT_BYPASS_TOKEN missing on this function). Nothing was written.',
        }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      let unchanged = 0;
      // Per-sync failure log. A sheet sync that reports success while silently writing
      // nothing is the failure mode this replaces, so every write error is captured and
      // surfaced in the response.
      const failures: Array<{ row: number; title: string; op: string; error?: string }> = [];
      // ONE Nexus read per sync, cached — the old code issued a SELECT per row.
      let _nexusRowsCache: any[] | null = null;
      const getNexusRowsOnce = async (owner: string): Promise<any[]> => {
        if (_nexusRowsCache === null) _nexusRowsCache = await fetchNexusAssignments(owner, { openOnly: false });
        return _nexusRowsCache;
      };
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

        if (!title || title === `Assignment ${i}`) continue;

        const dueDate = parseDate(dueDateStr);

        processed++;

        // Find or create course
        let courseId = null;
        if (courseName) {
          const { data: existingCourse } = await adminClient
            .from('courses')
            .select('id')
            .eq('user_id', writeUserId)
            .eq('name', courseName)
            .limit(1)
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

        // Check existing by sheet_row_number — use limit(1) to avoid maybeSingle crash on dupes
        // Assignments now live in NEXUS (Azure). Read the owner's rows once per sync and
        // match on sheet_row_number the way the Supabase query did. Supabase
        // public.assignments is a dead snapshot and writing there produced a second,
        // divergent source of truth that nothing reads any more.
        const nexusRows = await getNexusRowsOnce(writeUserId);
        const existing = nexusRows.find((r: any) =>
          String(r.program_id ?? '') === String(embaProgram?.id ?? '')
          && Number(r.sheet_row_number) === i) || null;


        if (existing) {
          const existingDue = existing.due_date ? new Date(existing.due_date).toISOString() : null;
          const hasChanges = existing.title !== title ||
            existingDue !== dueDate ||
            (existing.description || '') !== (description || '') ||
            (existing.priority || 'medium') !== (priority || 'medium');

          if (hasChanges) {
            const upd = await updateNexusAssignment(writeUserId, existing.id, {
                title,
                description,
                due_date: dueDate,
                course_id: courseId,
                priority: priority as any,
                points,
                assignment_url: assignmentUrl || null,
                program_id: embaProgram?.id || null,
                updated_at: new Date().toISOString()
            });
            if (!upd.ok) {
              console.error(`[EMBA_SHEETS] Nexus update failed for row ${i}: ${upd.error}`);
              failures.push({ row: i, title, op: 'update', error: upd.error });
            } else {
              updated++;
            }
            console.log(`Updated row ${i}: "${title}" due=${dueDate}`);
          } else {
            unchanged++;
          }
          assignmentIds.push(existing.id);
        } else {
          const ins = await createNexusAssignment(writeUserId, {
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
          });
          if (!ins.ok) {
            console.error(`[EMBA_SHEETS] Nexus insert failed for row ${i}: ${ins.error}`);
            failures.push({ row: i, title, op: 'insert', error: ins.error });
          }
          const newAssignment = ins.ok ? (ins.data?.rows?.[0] ?? ins.data?.[0] ?? ins.data) : null;

          if (newAssignment) {
            added++;
            assignmentIds.push(newAssignment.id);
            console.log(`Added row ${i}: "${title}" due=${dueDate}`);
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

      // Auto-promote assignments → tasks (fire-and-log; non-blocking error)
      let promotion: any = null;
      try {
        console.log(`[EMBA_SYNC] Invoking nightly-assignment-sync for ${writeUserId}...`);
        const promoResp = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/nightly-assignment-sync`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
            },
            body: JSON.stringify({ userId: writeUserId, timezone: 'America/New_York' }),
          }
        );
        if (promoResp.ok) {
          promotion = await promoResp.json();
          console.log(`[EMBA_SYNC] Promotion: ${promotion.created?.length || 0} created, ${promotion.repaired?.length || 0} repaired, ${promotion.skipped?.length || 0} skipped`);
        } else {
          console.warn(`[EMBA_SYNC] Promotion failed: ${promoResp.status}`);
        }
      } catch (promoErr) {
        console.warn(`[EMBA_SYNC] Promotion error (non-fatal):`, promoErr);
      }

      return new Response(
        JSON.stringify({ success: failures.length === 0, processed, added, updated, unchanged, failed: failures.length, failures, assignmentIds, promotion }),
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
