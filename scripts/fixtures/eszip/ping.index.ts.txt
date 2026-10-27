/**
 * Ping Edge Function - Health check with deployment version info
 * 
 * This function:
 * - Requires no secrets or authentication
 * - Returns comprehensive deployment info for debugging
 * - Logs request info to edge function logs for visibility
 * 
 * Use this to verify:
 * - Edge function connectivity from the frontend
 * - Which version of the code is deployed
 * - Whether published site is using latest code vs cache
 */

import { GLOBAL_VERSION, FUNCTION_IDS, corsHeaders } from "../_shared/config.ts";

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

  // Build comprehensive deployment info
  const deploymentInfo = {
    ok: true,
    global_version: GLOBAL_VERSION,
    function_versions: Object.fromEntries(
      Object.entries(FUNCTION_IDS).map(([key, id]) => [key, `${GLOBAL_VERSION}-${id}`])
    ),
    timestamp: new Date().toISOString(),
    processingTimeMs: processingTime,
    environment: Deno.env.get('SUPABASE_URL')?.includes('supabase.co') ? 'production' : 'local',
    status: 'healthy',
    received: {
      origin: requestInfo.origin,
      boot_id: body.boot_id || null,
      probe: body.probe || false
    }
  };

  console.log('[PING] Response:', JSON.stringify(deploymentInfo));

  return new Response(JSON.stringify(deploymentInfo), {
    headers: { 
      ...corsHeaders, 
      'Content-Type': 'application/json' 
    }
  });
});
