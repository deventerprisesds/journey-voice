import { TwilioCallSession } from './TwilioCallSession';
import { handleNotify, type NotifyEnv } from './notify';
import { handleSlackEvents, type SlackEventsEnv } from './slack-events';

interface Env extends NotifyEnv, SlackEventsEnv {
  CALL_SESSIONS: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  OPENAI_API_KEY: string;
}

export { TwilioCallSession };

export default {
  // `ctx` is new here. The Slack route needs `waitUntil`: Slack abandons a delivery it cannot get
  // an answer to in 3 seconds, an agent turn takes far longer, so the 200 goes back first and the
  // turn finishes under `waitUntil`. Without it the isolate can be torn down mid-turn.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          version: '2026-03-11-cf-v9',
          timestamp: new Date().toISOString()
        }),
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Notification delivery — journey's OWN endpoint, replacing the n8n webhook hop.
    // Purely additive: no existing route's behaviour changes, and nothing points here until
    // journey's UNIFIED_WEBHOOK_URL is repointed, which is a separate deliberate step.
    if (url.pathname === '/notify') {
      return handleNotify(request, env);
    }

    // Inbound Slack — Slack PUSHES message events here. Additive and inert: nothing reaches this
    // route until the URL is registered in the Slack app's Event Subscriptions, and every request
    // is refused unless it carries a valid Slack signature.
    if (url.pathname === '/slack/events') {
      return handleSlackEvents(request, env, ctx);
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
