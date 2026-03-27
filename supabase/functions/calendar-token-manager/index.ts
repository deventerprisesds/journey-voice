import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface TokenRequest {
  action: 'get' | 'update' | 'revoke' | 'get_oauth_url' | 'exchange_code' | 'update_purposes' | 'refresh'
  connectionId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  provider?: string
  code?: string
  redirect_uri?: string
  purposes?: string[]  // NEW: For setting connection purposes (READ, WRITE)
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, connectionId, accessToken, refreshToken, expiresAt, provider, code, redirect_uri, purposes }: TokenRequest = await req.json()
    
    // Get the Authorization header from the request
    const authHeader = req.headers.get('Authorization')
    
    // For get_oauth_url, auth is optional - allow unauthenticated requests
    const requiresAuth = action !== 'get_oauth_url'
    
    if (requiresAuth && !authHeader?.startsWith('Bearer ')) {
      console.error('[calendar-token-manager] No authorization header for action:', action)
      return new Response(
        JSON.stringify({ error: 'User authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create client - use service role for database operations, but validate user JWT separately
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined
    )

    // For authenticated actions, validate the JWT and extract user ID
    let userId: string | null = null
    if (requiresAuth && authHeader) {
      const token = authHeader.replace('Bearer ', '')
      const { data: claims, error: claimsError } = await supabaseClient.auth.getClaims(token)
      
      if (claimsError || !claims?.claims?.sub) {
        console.error('[calendar-token-manager] JWT validation failed:', claimsError?.message || 'No claims found')
        return new Response(
          JSON.stringify({ error: 'User authentication required' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      userId = claims.claims.sub as string
      console.log('[calendar-token-manager] Authenticated user:', userId)
    }

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
        
        if (!userId) {
          throw new Error('User authentication required for token exchange')
        }
        
        result = await exchangeCodeForTokens(supabaseClient, provider, code, redirect_uri, userId)
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

      case 'update_purposes':
        if (!connectionId || !purposes) {
          throw new Error('Missing connection ID or purposes for update')
        }

        // Update connection purposes
        const { data: purposeUpdated, error: purposeError } = await supabaseClient
          .rpc('update_calendar_connection_purposes', {
            _connection_id: connectionId,
            _purposes: purposes
          })

        if (purposeError) throw purposeError
        
        result = { success: purposeUpdated }
        console.log(`[calendar-token-manager] Updated purposes for connection ${connectionId} to: ${purposes.join(', ')}`)
        break

      case 'refresh':
        if (!connectionId) {
          throw new Error('Missing connection ID for refresh')
        }
        if (!userId) {
          throw new Error('User authentication required for token refresh')
        }
        
        result = await refreshConnectionToken(supabaseClient, connectionId, userId)
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
  console.log(`Exchanging code for ${provider} tokens for user: ${userId}`);
  
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
  
  // Check if connection already exists for this provider + account
  const { data: existing, error: lookupError } = await supabaseClient
    .from('calendar_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .eq('provider_account_id', userInfo.id)
    .maybeSingle();

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.error('Error checking existing Google connection:', lookupError);
    throw new Error(`Failed to check existing connection: ${lookupError.message}`);
  }

  if (existing) {
    // UPDATE existing connection with fresh tokens
    console.log(`Refreshing existing Google connection ${existing.id} with new tokens`);
    
    const { error: updateError } = await supabaseClient
      .rpc('update_calendar_connection_tokens_for_user', {
        _connection_id: existing.id,
        _user_id: userId,
        _access_token: tokens.access_token,
        _refresh_token: tokens.refresh_token || null,
        _expires_at: expiresAt
      });

    if (updateError) {
      console.error('Failed to refresh Google connection:', updateError);
      throw new Error(`REFRESH_FAILED: Could not refresh existing connection`);
    }

    console.log(`Successfully refreshed Google connection: ${existing.id}`);
    
    return {
      success: true,
      connection_id: existing.id,
      provider: 'google',
      email: userInfo.email,
      refreshed: true,
      message: 'Connection refreshed with new tokens'
    };
  }

  // Store new connection using secure RPC with explicit user_id
  const { data: connectionId, error: insertError } = await supabaseClient
    .rpc('insert_calendar_connection_for_user', {
      _user_id: userId,
      _provider: 'google',
      _provider_account_id: userInfo.id,
      _provider_account_email: userInfo.email,
      _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null,
      _scope: tokens.scope || null,
      _expires_at: expiresAt,
      _purposes: ['READ', 'WRITE']
    });
  
  if (insertError) {
    // Handle duplicate key as success (race condition)
    if (insertError.code === '23505') {
      console.log('Duplicate Google connection detected (race condition), treating as success');
      return {
        success: true,
        provider: 'google',
        email: userInfo.email,
        refreshed: true,
        message: 'Connection already exists and is valid'
      };
    }
    console.error('Failed to store Google connection:', insertError);
    throw new Error(`Failed to store connection: ${insertError.message}`);
  }
  
  console.log(`Successfully stored Google connection: ${connectionId}`);

  // Cleanup: Deactivate older active Google connections for this user
  if (connectionId) {
    const { error: cleanupError } = await supabaseClient
      .from('calendar_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', 'google')
      .eq('is_active', true)
      .neq('id', connectionId);

    if (cleanupError) {
      console.warn('[calendar-token-manager] Failed to cleanup old Google connections:', cleanupError);
    } else {
      console.log('[calendar-token-manager] Deactivated any older Google connections');
    }
  }
  
  return {
    success: true,
    connection_id: connectionId,
    provider: 'google',
    email: userInfo.email,
    refreshed: false,
    message: 'New connection created'
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
  const userEmail = userInfo.mail || userInfo.userPrincipalName;
  console.log(`Got Microsoft user email: ${userEmail}`);
  
  // Calculate expiry time
  const expiresAt = tokens.expires_in 
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  
  // Check if connection already exists for this provider + account
  // Accept both 'outlook' and 'office365' as provider names
  // Use order + limit to handle multiple rows gracefully
  const { data: existingConnections, error: lookupError } = await supabaseClient
    .from('calendar_connections')
    .select('id')
    .eq('user_id', userId)
    .in('provider', ['outlook', 'office365'])
    .eq('provider_account_id', userInfo.id)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (lookupError) {
    console.error('Error checking existing Microsoft connection:', lookupError);
    throw new Error(`Failed to check existing connection: ${lookupError.message}`);
  }

  const existing = existingConnections?.[0] || null;
  let chosenConnectionId: string | null = null;

  if (existing) {
    // UPDATE existing connection with fresh tokens
    console.log(`Refreshing existing Microsoft connection ${existing.id} with new tokens`);
    
    const { error: updateError } = await supabaseClient
      .rpc('update_calendar_connection_tokens_for_user', {
        _connection_id: existing.id,
        _user_id: userId,
        _access_token: tokens.access_token,
        _refresh_token: tokens.refresh_token || null,
        _expires_at: expiresAt
      });

    if (updateError) {
      console.error('Failed to refresh Microsoft connection:', updateError);
      throw new Error(`REFRESH_FAILED: Could not refresh existing connection`);
    }

    chosenConnectionId = existing.id;
    console.log(`Successfully refreshed Microsoft connection: ${existing.id}`);
  } else {
    // Store new connection using secure RPC with explicit user_id
    const { data: connectionId, error: insertError } = await supabaseClient
      .rpc('insert_calendar_connection_for_user', {
        _user_id: userId,
        _provider: 'outlook',
        _provider_account_id: userInfo.id,
        _provider_account_email: userEmail,
        _access_token: tokens.access_token,
        _refresh_token: tokens.refresh_token || null,
        _scope: tokens.scope || null,
        _expires_at: expiresAt
      });
    
    if (insertError) {
      // Handle duplicate key as success (race condition)
      if (insertError.code === '23505') {
        console.log('Duplicate Microsoft connection detected (race condition), treating as success');
        return {
          success: true,
          provider: 'outlook',
          email: userEmail,
          refreshed: true,
          message: 'Connection already exists and is valid'
        };
      }
      console.error('Failed to store Microsoft connection:', insertError);
      throw new Error(`Failed to store connection: ${insertError.message}`);
    }
    
    chosenConnectionId = connectionId;
    console.log(`Successfully stored Microsoft connection: ${connectionId}`);
  }

  // Cleanup: Deactivate older active Outlook/Office365 connections for this user
  // This ensures only one active Microsoft connection exists going forward
  if (chosenConnectionId) {
    const { error: cleanupError } = await supabaseClient
      .from('calendar_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('provider', ['outlook', 'office365'])
      .eq('is_active', true)
      .neq('id', chosenConnectionId);

    if (cleanupError) {
      console.warn('[calendar-token-manager] Failed to cleanup old Microsoft connections:', cleanupError);
      // Don't fail the whole operation for cleanup issues
    } else {
      console.log('[calendar-token-manager] Deactivated any older Microsoft connections');
    }
  }
  
  return {
    success: true,
    connection_id: chosenConnectionId,
    provider: 'outlook',
    email: userEmail,
    refreshed: !!existing,
    message: existing ? 'Connection refreshed with new tokens' : 'New connection created'
  };
}

// Silently refresh a connection using stored refresh_token
async function refreshConnectionToken(supabaseClient: any, connectionId: string, userId: string) {
  console.log(`[calendar-token-manager] Refreshing connection ${connectionId} for user ${userId}`);
  
  // Get connection details with decrypted tokens using service role
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  
  const { data: connection, error: connError } = await serviceClient
    .from('calendar_connections')
    .select('id, provider, refresh_token, user_id, provider_account_id, provider_account_email')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .single();

  if (connError || !connection) {
    throw new Error('Connection not found or access denied');
  }

  if (!connection.refresh_token) {
    throw new Error('No refresh token stored — full re-authorization required');
  }

  // Decrypt refresh token
  const { data: decrypted, error: decryptError } = await serviceClient
    .rpc('get_calendar_connection_tokens', { _connection_id: connectionId });

  if (decryptError || !decrypted?.[0]?.refresh_token) {
    // The RPC requires auth.uid() — use the user's supabaseClient instead
    const { data: userDecrypted, error: userDecryptError } = await supabaseClient
      .rpc('get_calendar_connection_tokens', { _connection_id: connectionId });
    
    if (userDecryptError || !userDecrypted?.[0]?.refresh_token) {
      throw new Error('Could not decrypt refresh token — full re-authorization required');
    }
    
    return await doTokenRefresh(supabaseClient, connection.provider, userDecrypted[0].refresh_token, connectionId, userId);
  }

  return await doTokenRefresh(supabaseClient, connection.provider, decrypted[0].refresh_token, connectionId, userId);
}

async function doTokenRefresh(supabaseClient: any, provider: string, refreshToken: string, connectionId: string, userId: string) {
  let tokenEndpoint: string;
  let body: URLSearchParams;

  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured');

    tokenEndpoint = 'https://oauth2.googleapis.com/token';
    body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
  } else if (provider === 'outlook' || provider === 'office365') {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials not configured');

    tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite User.Read offline_access',
    });
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const tokenResponse = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    console.error(`[calendar-token-manager] Token refresh failed for ${provider}:`, errText);
    throw new Error(`Token refresh failed — full re-authorization required`);
  }

  const tokens = await tokenResponse.json();
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // Update tokens in DB
  const { error: updateError } = await supabaseClient
    .rpc('update_calendar_connection_tokens_for_user', {
      _connection_id: connectionId,
      _user_id: userId,
      _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null,
      _expires_at: expiresAt,
    });

  if (updateError) {
    console.error('[calendar-token-manager] Failed to store refreshed tokens:', updateError);
    throw new Error('Failed to store refreshed tokens');
  }

  console.log(`[calendar-token-manager] Successfully refreshed ${provider} connection ${connectionId}`);
  return {
    success: true,
    connection_id: connectionId,
    provider,
    refreshed: true,
    message: 'Connection refreshed successfully',
  };
}
