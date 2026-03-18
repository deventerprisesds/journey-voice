import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { action, userId } = await req.json();

  if (action === 'delete_test_tasks') {
    // Delete all test/junk tasks
    const { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('user_id', userId)
      .or('title.ilike.%Test Task%,title.ilike.%🧪%')
      .select('id, title');

    return new Response(JSON.stringify({ deleted: data, error }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'unschedule_stale') {
    // Reset all currently scheduled incomplete tasks
    const { data, error } = await supabase
      .from('tasks')
      .update({
        is_scheduled: false,
        start_time: null,
        end_time: null,
        status: 'UP_NEXT',
        pushed_count: 1, // will be incremented properly by nightly builder
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('is_scheduled', true)
      .neq('status', 'DONE')
      .is('completed_at', null)
      .select('id, title');

    return new Response(JSON.stringify({ unscheduled: data, error }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
