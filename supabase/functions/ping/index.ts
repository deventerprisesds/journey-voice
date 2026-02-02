/**
 * Ping Edge Function - Minimal health check for connectivity probing
 * 
 * This function:
 * - Requires no secrets or authentication
 * - Logs request info to edge function logs for visibility
 * - Returns a simple JSON response with timestamp
 * 
 * Use this to verify edge function connectivity from the frontend
 * when supabase-js might be hung or unavailable.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  // Extract request info for logging
  const requestInfo = {
    method: req.method,
    url: req.url,
    origin: req.headers.get('origin'),
    userAgent: req.headers.get('user-agent'),
    timestamp: new Date().toISOString()
  };

  // Log to edge function logs (always visible in Supabase dashboard)
  console.log('[PING] Request received:', JSON.stringify(requestInfo));

  // Try to parse body if present
  let body: Record<string, unknown> = {};
  try {
    if (req.method === 'POST') {
      body = await req.json();
      console.log('[PING] Request body:', JSON.stringify(body));
    }
  } catch {
    // Ignore body parsing errors
  }

  const processingTime = Date.now() - startTime;

  // Build response
  const response = {
    ok: true,
    timestamp: new Date().toISOString(),
    processingTimeMs: processingTime,
    received: {
      origin: requestInfo.origin,
      boot_id: body.boot_id || null,
      probe: body.probe || false
    }
  };

  console.log('[PING] Response:', JSON.stringify(response));

  return new Response(JSON.stringify(response), {
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'application/json' 
    }
  });
});
