import { TwilioCallSession } from './TwilioCallSession';

interface Env {
  CALL_SESSIONS: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  OPENAI_API_KEY: string;
}

export { TwilioCallSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          version: '2026-01-28-cf-v2',
          timestamp: new Date().toISOString()
        }),
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // WebSocket endpoint for Twilio
    if (url.pathname === '/call') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Create unique Durable Object ID for this call
      const callId = url.searchParams.get('callId') || crypto.randomUUID();
      const id = env.CALL_SESSIONS.idFromName(callId);
      const stub = env.CALL_SESSIONS.get(id);

      // Forward request to Durable Object
      return stub.fetch(request);
    }

    // 404 for unknown routes
    return new Response('Not Found', { status: 404 });
  }
};
