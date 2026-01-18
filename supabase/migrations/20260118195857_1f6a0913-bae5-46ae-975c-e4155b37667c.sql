UPDATE user_scheduling_prefs 
SET realtime_extensions = COALESCE(realtime_extensions, '') || '

CONVERSATIONAL RESPONSIVENESS - CRITICAL FOR VOICE:
When processing a query that requires tool execution:
1. IMMEDIATE (before calling any tool): Acknowledge with a brief natural phrase like:
   - "Let me check on that..."
   - "One moment..."
   - "Let me take a look..."
   - "Let me find that for you..."
   
2. If tool execution takes longer than expected (you sense delay), inject brief updates:
   - "Still looking..."
   - "Almost there..."
   - "Just checking one more thing..."
   
3. NEVER stay silent while processing - humans need verbal feedback
4. Vary your phrases naturally - do not repeat the same acknowledgment
5. Keep interim phrases SHORT (2-4 words) - you are not answering yet, just acknowledging'
WHERE user_id IS NOT NULL;