
# Plan: Add Quota Exceeded Banner Alert System

## Problem Summary

When ElevenLabs or OpenAI quota is exhausted, voice functionality silently fails. This leads to hours of debugging because there's no visible indication to the user that the issue is a simple billing/quota problem.

**Current state:**
- ElevenLabs quota errors are logged to `error_log` table (found error from Feb 6: `quota_exceeded`)
- No UI surfaces these errors to the user
- User must dig through edge function logs or database to discover the issue

---

## Solution Overview

Create a **persistent alert banner** at the top of the app that:
1. Monitors the `error_log` table for recent quota-related errors
2. Displays a dismissible banner when quota issues are detected
3. Provides direct links to resolve the issue (ElevenLabs dashboard, OpenAI billing)
4. Auto-dismisses after the quota is restored

---

## Technical Implementation

### Part 1: Enhance Edge Function Error Logging

Update `supabase/functions/elevenlabs-tts/index.ts` to log quota errors with a specific error type that the frontend can query:

```typescript
// When ElevenLabs returns 401 with quota_exceeded
if (errorText.includes('quota_exceeded')) {
  // Log to error_log for banner visibility
  await supabase.from('error_log').insert({
    source: 'edge_function',
    component: 'elevenlabs-tts',
    error_type: 'quota_exceeded_elevenlabs',
    error_message: 'ElevenLabs quota exhausted - voice features unavailable',
    context: { details: errorText }
  });
}
```

Similarly update `twilio-realtime-bridge` and `generate-realtime-token` for OpenAI quota errors.

### Part 2: Create QuotaAlertBanner Component

New file: `src/components/QuotaAlertBanner.tsx`

Features:
- Queries `error_log` for recent quota errors (last 24 hours)
- Polls every 60 seconds to detect new issues
- Shows different banners for ElevenLabs vs OpenAI
- Dismissible (stores dismissed state in localStorage with expiry)
- Links to respective billing dashboards

```typescript
interface QuotaAlert {
  provider: 'elevenlabs' | 'openai';
  message: string;
  link: string;
  timestamp: string;
}

const QuotaAlertBanner: React.FC = () => {
  const [alerts, setAlerts] = useState<QuotaAlert[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  
  useEffect(() => {
    const checkQuotaErrors = async () => {
      const { data } = await supabase
        .from('error_log')
        .select('*')
        .in('error_type', ['quota_exceeded_elevenlabs', 'quota_exceeded_openai'])
        .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(5);
      
      // Process and dedupe alerts...
    };
    
    checkQuotaErrors();
    const interval = setInterval(checkQuotaErrors, 60000);
    return () => clearInterval(interval);
  }, []);
  
  if (alerts.length === 0) return null;
  
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground">
      {/* Alert content with dismiss button and billing link */}
    </div>
  );
};
```

### Part 3: Integrate Banner in App.tsx

Add `QuotaAlertBanner` alongside `DemoModeBadge`:

```typescript
// In App.tsx, inside AuthProvider:
<DemoModeBadge />
<QuotaAlertBanner />
<ErrorBoundary>
  {/* Routes */}
</ErrorBoundary>
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/QuotaAlertBanner.tsx` | Create | New banner component with quota error detection |
| `src/App.tsx` | Modify | Add QuotaAlertBanner to app layout |
| `supabase/functions/elevenlabs-tts/index.ts` | Modify | Log quota errors with specific error_type |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Modify | Log ElevenLabs quota errors during calls |
| `supabase/functions/generate-realtime-token/index.ts` | Modify | Log OpenAI quota errors |

---

## Banner Design

The banner will appear fixed at the very top of the viewport:

```
+------------------------------------------------------------------+
| ⚠️ ElevenLabs quota exhausted - Voice features unavailable       |
|    [Add Credits →]                              [Dismiss for 1h] |
+------------------------------------------------------------------+
```

For OpenAI:
```
+------------------------------------------------------------------+
| ⚠️ OpenAI API quota exceeded - AI features unavailable           |
|    [Check Billing →]                            [Dismiss for 1h] |
+------------------------------------------------------------------+
```

---

## Query for Quota Errors

The banner will use this query to detect quota issues:

```sql
SELECT DISTINCT ON (error_type) 
  error_type, error_message, created_at, context
FROM error_log
WHERE error_type IN ('quota_exceeded_elevenlabs', 'quota_exceeded_openai', 'tts_failed')
  AND (error_message ILIKE '%quota%' OR context::text ILIKE '%quota%')
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY error_type, created_at DESC;
```

---

## Dismissal Logic

- User can dismiss banner for 1 hour
- Stored in localStorage: `quota_alert_dismissed_{provider}_{timestamp}`
- Auto-clears after 1 hour
- Re-appears if a NEW quota error occurs after dismissal

---

## Testing Plan

1. Trigger an ElevenLabs quota error (call with exhausted credits)
2. Verify banner appears at top of app
3. Click "Add Credits" - verify it opens ElevenLabs dashboard
4. Click "Dismiss" - verify banner hides
5. Wait 1 hour or clear localStorage - verify banner reappears
6. Add credits and make successful call - verify banner auto-clears within 60s
