import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TokenRequest {
  action: 'get' | 'update' | 'revoke'
  connectionId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the Authorization header from the request
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    // Set the Authorization header for the supabase client
    supabaseClient.auth.setSession({
      access_token: authHeader.replace('Bearer ', ''),
      refresh_token: ''
    })

    const { action, connectionId, accessToken, refreshToken, expiresAt }: TokenRequest = await req.json()

    let result
    switch (action) {
      case 'get':
        // Get calendar connections with decrypted tokens
        const { data: connections, error: getError } = await supabaseClient
          .rpc('get_calendar_connections_secure')
        
        if (getError) throw getError
        
        result = { connections }
        break

      case 'update':
        if (!connectionId || !accessToken) {
          throw new Error('Missing required parameters for token update')
        }

        // Update tokens securely
        const { data: updated, error: updateError } = await supabaseClient
          .rpc('update_calendar_connection_tokens', {
            _connection_id: connectionId,
            _access_token: accessToken,
            _refresh_token: refreshToken,
            _expires_at: expiresAt
          })

        if (updateError) throw updateError
        
        result = { success: updated }
        break

      case 'revoke':
        if (!connectionId) {
          throw new Error('Missing connection ID for revocation')
        }

        // Revoke connection securely
        const { data: revoked, error: revokeError } = await supabaseClient
          .rpc('revoke_calendar_connection', {
            _connection_id: connectionId
          })

        if (revokeError) throw revokeError
        
        result = { success: revoked }
        break

      default:
        throw new Error('Invalid action specified')
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error: any) {
    console.error('Calendar token manager error:', error)
    return new Response(
      JSON.stringify({ 
        error: error?.message || 'Internal server error',
        details: 'Failed to manage calendar tokens'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})