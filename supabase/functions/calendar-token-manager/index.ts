import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TokenRequest {
  action: 'get' | 'update' | 'revoke' | 'get_oauth_url' | 'exchange_code'
  connectionId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  provider?: string
  code?: string
  redirect_uri?: string
}

serve(async (req) => {
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

    const { action, connectionId, accessToken, refreshToken, expiresAt, provider, code, redirect_uri }: TokenRequest = await req.json()

    let result
    switch (action) {
      case 'get_oauth_url':
        if (!provider) {
          throw new Error('Provider is required for OAuth URL generation')
        }
        
        result = await getOAuthUrl(provider, redirect_uri || `${req.headers.get('origin')}/settings`)
        break

      case 'exchange_code':
        if (!provider || !code || !redirect_uri) {
          throw new Error('Provider, code, and redirect_uri are required for token exchange')
        }
        
        // Get user from session
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) {
          throw new Error('User authentication required')
        }
        
        result = await exchangeCodeForTokens(supabaseClient, provider, code, redirect_uri, user.id)
        break

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
});

// Generate OAuth authorization URL
async function getOAuthUrl(provider: string, redirectUri: string) {
  console.log(`Generating OAuth URL for provider: ${provider}`);
  
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID not configured');
    }
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state: 'google'
    });
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    console.log('Generated Google OAuth URL');
    return { auth_url: authUrl };
    
  } else if (provider === 'outlook' || provider === 'microsoft') {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    if (!clientId) {
      throw new Error('MICROSOFT_CLIENT_ID not configured');
    }
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'Calendars.ReadWrite User.Read offline_access',
      state: 'outlook'
    });
    
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    console.log('Generated Microsoft OAuth URL');
    return { auth_url: authUrl };
    
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

// Exchange authorization code for access tokens
async function exchangeCodeForTokens(supabaseClient: any, provider: string, code: string, redirectUri: string, userId: string) {
  console.log(`Exchanging code for ${provider} tokens`);
  
  if (provider === 'google') {
    return await exchangeGoogleCode(supabaseClient, code, redirectUri, userId);
  } else if (provider === 'outlook' || provider === 'microsoft') {
    return await exchangeMicrosoftCode(supabaseClient, code, redirectUri, userId);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

// Exchange Google authorization code
async function exchangeGoogleCode(supabaseClient: any, code: string, redirectUri: string, userId: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured');
  }
  
  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  
  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.error('Google token exchange failed:', error);
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }
  
  const tokens = await tokenResponse.json();
  console.log('Successfully exchanged Google code for tokens');
  
  // Get user email
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
    },
  });
  
  if (!userInfoResponse.ok) {
    throw new Error('Failed to fetch user info from Google');
  }
  
  const userInfo = await userInfoResponse.json();
  console.log(`Got Google user email: ${userInfo.email}`);
  
  // Calculate expiry time
  const expiresAt = tokens.expires_in 
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  
  // Store connection using secure RPC
  const { data: connectionId, error: insertError } = await supabaseClient
    .rpc('insert_calendar_connection', {
      _provider: 'google',
      _provider_account_id: userInfo.id,
      _provider_account_email: userInfo.email,
      _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null,
      _scope: tokens.scope || null,
      _expires_at: expiresAt
    });
  
  if (insertError) {
    console.error('Failed to store Google connection:', insertError);
    throw new Error(`Failed to store connection: ${insertError.message}`);
  }
  
  console.log(`Successfully stored Google connection: ${connectionId}`);
  
  return {
    success: true,
    connection_id: connectionId,
    provider: 'google',
    email: userInfo.email
  };
}

// Exchange Microsoft authorization code
async function exchangeMicrosoftCode(supabaseClient: any, code: string, redirectUri: string, userId: string) {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  
  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth credentials not configured');
  }
  
  // Exchange code for tokens
  const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  
  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.error('Microsoft token exchange failed:', error);
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }
  
  const tokens = await tokenResponse.json();
  console.log('Successfully exchanged Microsoft code for tokens');
  
  // Get user info
  const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
    },
  });
  
  if (!userInfoResponse.ok) {
    throw new Error('Failed to fetch user info from Microsoft');
  }
  
  const userInfo = await userInfoResponse.json();
  console.log(`Got Microsoft user email: ${userInfo.mail || userInfo.userPrincipalName}`);
  
  // Calculate expiry time
  const expiresAt = tokens.expires_in 
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  
  // Store connection using secure RPC
  const { data: connectionId, error: insertError } = await supabaseClient
    .rpc('insert_calendar_connection', {
      _provider: 'outlook',
      _provider_account_id: userInfo.id,
      _provider_account_email: userInfo.mail || userInfo.userPrincipalName,
      _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null,
      _scope: tokens.scope || null,
      _expires_at: expiresAt
    });
  
  if (insertError) {
    console.error('Failed to store Microsoft connection:', insertError);
    throw new Error(`Failed to store connection: ${insertError.message}`);
  }
  
  console.log(`Successfully stored Microsoft connection: ${connectionId}`);
  
  return {
    success: true,
    connection_id: connectionId,
    provider: 'outlook',
    email: userInfo.mail || userInfo.userPrincipalName
  };
}