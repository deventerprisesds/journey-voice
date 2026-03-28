import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

interface TokenRequest {
  action: 'get' | 'update' | 'revoke' | 'get_oauth_url' | 'exchange_code' | 'update_purposes' | 'refresh' | 'disconnect'
  connectionId?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: string
  provider?: string
  code?: string
  redirect_uri?: string
  purposes?: string[]
}

// Trace helper — logs to error_log table for remote debugging
async function trace(supabaseClient: any, userId: string | null, stage: string, details: Record<string, any>) {
  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    await serviceClient.from('error_log').insert({
      user_id: userId,
      error_type: 'oauth_trace',
      error_message: stage,
      source: 'calendar-token-manager',
      component: details.provider || 'unknown',
      context: details,
    });
  } catch (e) {
    console.warn('[trace] Failed to write trace:', e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, connectionId, accessToken, refreshToken, expiresAt, provider, code, redirect_uri, purposes }: TokenRequest = await req.json()
    
    const authHeader = req.headers.get('Authorization')
    const requiresAuth = action !== 'get_oauth_url'
    
    if (requiresAuth && !authHeader?.startsWith('Bearer ')) {
      console.error('[calendar-token-manager] No authorization header for action:', action)
      return new Response(
        JSON.stringify({ error: 'User authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined
    )

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
        if (!provider) throw new Error('Provider is required for OAuth URL generation')
        result = await getOAuthUrl(provider, redirect_uri || `${req.headers.get('origin')}/settings`)
        break

      case 'exchange_code':
        if (!provider || !code || !redirect_uri) throw new Error('Provider, code, and redirect_uri are required for token exchange')
        if (!userId) throw new Error('User authentication required for token exchange')
        result = await exchangeCodeForTokens(supabaseClient, provider, code, redirect_uri, userId)
        break

      case 'get':
        const { data: connections, error: getError } = await supabaseClient.rpc('get_calendar_connections_secure')
        if (getError) throw getError
        result = { connections }
        break

      case 'update':
        if (!connectionId || !accessToken) throw new Error('Missing required parameters for token update')
        const { data: updated, error: updateError } = await supabaseClient.rpc('update_calendar_connection_tokens', {
          _connection_id: connectionId, _access_token: accessToken, _refresh_token: refreshToken, _expires_at: expiresAt
        })
        if (updateError) throw updateError
        result = { success: updated }
        break

      case 'revoke':
        if (!connectionId) throw new Error('Missing connection ID for revocation')
        const { data: revoked, error: revokeError } = await supabaseClient.rpc('revoke_calendar_connection', { _connection_id: connectionId })
        if (revokeError) throw revokeError
        result = { success: revoked }
        break

      case 'disconnect':
        if (!connectionId) throw new Error('Missing connection ID for disconnect')
        if (!userId) throw new Error('User authentication required for disconnect')
        {
          const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
          const { error: disconnectError } = await serviceClient
            .from('calendar_connections')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', connectionId)
            .eq('user_id', userId);
          if (disconnectError) throw disconnectError;
          await trace(supabaseClient, userId, 'disconnect_success', { connectionId });
          result = { success: true };
        }
        break

      case 'update_purposes':
        if (!connectionId || !purposes) throw new Error('Missing connection ID or purposes for update')
        const { data: purposeUpdated, error: purposeError } = await supabaseClient.rpc('update_calendar_connection_purposes', {
          _connection_id: connectionId, _purposes: purposes
        })
        if (purposeError) throw purposeError
        result = { success: purposeUpdated }
        console.log(`[calendar-token-manager] Updated purposes for connection ${connectionId} to: ${purposes.join(', ')}`)
        break

      case 'refresh':
        if (!connectionId) throw new Error('Missing connection ID for refresh')
        if (!userId) throw new Error('User authentication required for token refresh')
        result = await refreshConnectionToken(supabaseClient, connectionId, userId)
        break

      default:
        throw new Error('Invalid action specified')
    }

    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error('Calendar token manager error:', error)
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error', details: 'Failed to manage calendar tokens' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
});

async function getOAuthUrl(provider: string, redirectUri: string) {
  console.log(`Generating OAuth URL for provider: ${provider}`);
  
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline', prompt: 'consent', state: 'google'
    });
    return { auth_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  } else if (provider === 'outlook' || provider === 'microsoft') {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    if (!clientId) throw new Error('MICROSOFT_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: 'Calendars.ReadWrite User.Read offline_access', state: 'outlook'
    });
    return { auth_url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}` };
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

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

async function exchangeGoogleCode(supabaseClient: any, code: string, redirectUri: string, userId: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured');

  await trace(supabaseClient, userId, 'google_exchange_start', { provider: 'google' });

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    await trace(supabaseClient, userId, 'google_exchange_failed', { provider: 'google', error });
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  const tokens = await tokenResponse.json();
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  });
  if (!userInfoResponse.ok) throw new Error('Failed to fetch user info from Google');
  const userInfo = await userInfoResponse.json();

  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  // Check for ANY existing connection (including deactivated) for this provider+account
  const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: existingRows, error: lookupError } = await serviceClient
    .from('calendar_connections')
    .select('id, is_active')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .eq('provider_account_id', userInfo.id)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (lookupError) {
    console.error('Error checking existing Google connection:', lookupError);
    throw new Error(`Failed to check existing connection: ${lookupError.message}`);
  }

  const existing = existingRows?.[0] || null;

  if (existing) {
    // Reactivate + update tokens on existing row (handles both active and deactivated)
    console.log(`Reactivating/refreshing existing Google connection ${existing.id}`);
    const { error: updateError } = await serviceClient.rpc('update_calendar_connection_tokens_for_user', {
      _connection_id: existing.id,
      _user_id: userId,
      _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null,
      _expires_at: expiresAt,
    });

    if (updateError) {
      await trace(supabaseClient, userId, 'google_reactivate_failed', { provider: 'google', error: updateError.message, connectionId: existing.id });
      throw new Error(`REFRESH_FAILED: Could not refresh existing connection`);
    }

    await trace(supabaseClient, userId, 'google_exchange_success', { provider: 'google', connectionId: existing.id, reactivated: !existing.is_active, refreshed: true });
    return { success: true, connection_id: existing.id, provider: 'google', email: userInfo.email, refreshed: true, message: 'Connection refreshed with new tokens' };
  }

  // Insert new connection
  const { data: connectionId, error: insertError } = await supabaseClient.rpc('insert_calendar_connection_for_user', {
    _user_id: userId, _provider: 'google', _provider_account_id: userInfo.id,
    _provider_account_email: userInfo.email, _access_token: tokens.access_token,
    _refresh_token: tokens.refresh_token || null, _scope: tokens.scope || null,
    _expires_at: expiresAt, _purposes: ['READ', 'WRITE']
  });

  if (insertError) {
    if (insertError.code === '23505') {
      // Race condition — find the existing row and reactivate
      const { data: raceRow } = await serviceClient
        .from('calendar_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'google')
        .eq('provider_account_id', userInfo.id)
        .limit(1)
        .single();

      if (raceRow) {
        await serviceClient.from('calendar_connections').update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || undefined,
          expires_at: expiresAt,
          is_active: true,
          updated_at: new Date().toISOString(),
        }).eq('id', raceRow.id);

        await trace(supabaseClient, userId, 'google_23505_reactivated', { provider: 'google', connectionId: raceRow.id });
        return { success: true, connection_id: raceRow.id, provider: 'google', email: userInfo.email, refreshed: true, message: 'Existing connection reactivated' };
      }
      return { success: true, provider: 'google', email: userInfo.email, refreshed: true, message: 'Connection already exists' };
    }
    throw new Error(`Failed to store connection: ${insertError.message}`);
  }

  await trace(supabaseClient, userId, 'google_exchange_success', { provider: 'google', connectionId, refreshed: false });
  return { success: true, connection_id: connectionId, provider: 'google', email: userInfo.email, refreshed: false, message: 'New connection created' };
}

async function exchangeMicrosoftCode(supabaseClient: any, code: string, redirectUri: string, userId: string) {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials not configured');

  await trace(supabaseClient, userId, 'microsoft_exchange_start', { provider: 'outlook' });

  const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    await trace(supabaseClient, userId, 'microsoft_exchange_failed', { provider: 'outlook', error });
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  const tokens = await tokenResponse.json();
  const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  });
  if (!userInfoResponse.ok) throw new Error('Failed to fetch user info from Microsoft');
  const userInfo = await userInfoResponse.json();

  // FIX: Prefer userPrincipalName (login/org email) over mail (personal recovery email)
  const userEmail = userInfo.userPrincipalName || userInfo.mail;
  console.log(`Got Microsoft user email: ${userEmail} (UPN: ${userInfo.userPrincipalName}, mail: ${userInfo.mail})`);

  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  // Check existing connections (including deactivated)
  const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: existingConnections, error: lookupError } = await serviceClient
    .from('calendar_connections')
    .select('id, is_active')
    .eq('user_id', userId)
    .in('provider', ['outlook', 'office365'])
    .eq('provider_account_id', userInfo.id)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (lookupError) throw new Error(`Failed to check existing connection: ${lookupError.message}`);

  const existing = existingConnections?.[0] || null;
  let chosenConnectionId: string | null = null;

  if (existing) {
    console.log(`Reactivating/refreshing existing Microsoft connection ${existing.id}`);
    const { error: updateError } = await serviceClient
      .from('calendar_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || undefined,
        expires_at: expiresAt,
        provider_account_email: userEmail,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) {
      await trace(supabaseClient, userId, 'microsoft_reactivate_failed', { provider: 'outlook', error: updateError.message });
      throw new Error(`REFRESH_FAILED: Could not refresh existing connection`);
    }
    chosenConnectionId = existing.id;
  } else {
    const { data: connectionId, error: insertError } = await supabaseClient.rpc('insert_calendar_connection_for_user', {
      _user_id: userId, _provider: 'outlook', _provider_account_id: userInfo.id,
      _provider_account_email: userEmail, _access_token: tokens.access_token,
      _refresh_token: tokens.refresh_token || null, _scope: tokens.scope || null,
      _expires_at: expiresAt, _purposes: ['READ', 'WRITE']
    });

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: raceRow } = await serviceClient
          .from('calendar_connections')
          .select('id')
          .eq('user_id', userId)
          .in('provider', ['outlook', 'office365'])
          .eq('provider_account_id', userInfo.id)
          .limit(1)
          .single();

        if (raceRow) {
          await serviceClient.from('calendar_connections').update({
            access_token: tokens.access_token, refresh_token: tokens.refresh_token || undefined,
            expires_at: expiresAt, provider_account_email: userEmail,
            is_active: true, updated_at: new Date().toISOString(),
          }).eq('id', raceRow.id);
          chosenConnectionId = raceRow.id;
        }
      } else {
        throw new Error(`Failed to store connection: ${insertError.message}`);
      }
    } else {
      chosenConnectionId = connectionId;
    }
  }

  await trace(supabaseClient, userId, 'microsoft_exchange_success', { provider: 'outlook', connectionId: chosenConnectionId, refreshed: !!existing });

  return {
    success: true, connection_id: chosenConnectionId, provider: 'outlook',
    email: userEmail, refreshed: !!existing,
    message: existing ? 'Connection refreshed with new tokens' : 'New connection created'
  };
}

async function refreshConnectionToken(supabaseClient: any, connectionId: string, userId: string) {
  console.log(`[calendar-token-manager] Refreshing connection ${connectionId} for user ${userId}`);
  
  const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  
  const { data: connection, error: connError } = await serviceClient
    .from('calendar_connections')
    .select('id, provider, refresh_token, user_id, provider_account_id, provider_account_email')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .single();

  if (connError || !connection) throw new Error('Connection not found or access denied');
  if (!connection.refresh_token) throw new Error('No refresh token stored — full re-authorization required');

  const { data: decrypted, error: decryptError } = await serviceClient
    .rpc('get_calendar_connection_tokens', { _connection_id: connectionId });

  if (decryptError || !decrypted?.[0]?.refresh_token) {
    const { data: userDecrypted, error: userDecryptError } = await supabaseClient
      .rpc('get_calendar_connection_tokens', { _connection_id: connectionId });
    if (userDecryptError || !userDecrypted?.[0]?.refresh_token) throw new Error('Could not decrypt refresh token — full re-authorization required');
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
    body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  } else if (provider === 'outlook' || provider === 'office365') {
    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID');
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials not configured');
    tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: 'Calendars.ReadWrite User.Read offline_access' });
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    console.error(`[calendar-token-manager] Token refresh failed for ${provider}:`, errText);
    throw new Error(`Token refresh failed — full re-authorization required`);
  }

  const tokens = await tokenResponse.json();
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  const { error: updateError } = await supabaseClient.rpc('update_calendar_connection_tokens_for_user', {
    _connection_id: connectionId, _user_id: userId, _access_token: tokens.access_token,
    _refresh_token: tokens.refresh_token || null, _expires_at: expiresAt,
  });

  if (updateError) {
    console.error('[calendar-token-manager] Failed to store refreshed tokens:', updateError);
    throw new Error('Failed to store refreshed tokens');
  }

  console.log(`[calendar-token-manager] Successfully refreshed ${provider} connection ${connectionId}`);
  return { success: true, connection_id: connectionId, provider, refreshed: true, message: 'Connection refreshed successfully' };
}
