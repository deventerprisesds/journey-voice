

# Unified Conversation Agenda System

## Current Problem

The **AgendaManager** class exists only in `twilio-realtime-bridge` (phone calls). This means:

| Feature | Phone (Twilio) | WebRTC Voice | Chat |
|---------|----------------|--------------|------|
| Track agenda items | Yes | No | No |
| Pause for tangents | Yes | No | No |
| Resume hints | Yes | No | No |
| Progress tracking | Yes | No | No |

This creates inconsistent behavior - a scheduled call can track "we discussed items 1, 2, and paused on 3" while WebRTC and chat have zero awareness of conversation flow.

---

## Solution: Database-Backed Shared Agenda State

Instead of an in-memory class that dies with each session, store agenda state in the database so any interface can read and update it.

### Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                    SHARED AGENDA STATE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐                                              │
│  │ conversation_ │  Stores agenda items, status, timestamps     │
│  │    agenda     │  Linked to ai_threads                        │
│  └───────┬───────┘                                              │
│          │                                                      │
│          │  All interfaces read/write                           │
│          │                                                      │
│  ┌───────┴───────┬───────────────┬───────────────┐              │
│  │               │               │               │              │
│  ▼               ▼               ▼               ▼              │
│ ┌───────┐   ┌───────┐   ┌───────┐   ┌───────┐                   │
│ │Twilio │   │WebRTC │   │ Chat  │   │Future │                   │
│ │Bridge │   │Voice  │   │Hybrid │   │Engines│                   │
│ └───────┘   └───────┘   └───────┘   └───────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Changes

### New Table: `conversation_agenda`

```sql
CREATE TABLE public.conversation_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  -- Agenda item details
  item_index INTEGER NOT NULL,        -- Order in agenda (0, 1, 2...)
  item_text TEXT NOT NULL,            -- "Discuss project timeline"
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, in_progress, paused, completed
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Tangent/pause tracking
  paused_for TEXT,                    -- User query that caused pause
  paused_at TIMESTAMPTZ,
  
  -- Context
  source TEXT,                        -- 'scheduled_call', 'manual', 'imported'
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(thread_id, item_index)
);

-- Indexes for fast queries
CREATE INDEX idx_conversation_agenda_thread ON conversation_agenda(thread_id);
CREATE INDEX idx_conversation_agenda_user_status ON conversation_agenda(user_id, status);

-- RLS
ALTER TABLE conversation_agenda ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own agenda" ON conversation_agenda
  FOR ALL USING (auth.uid() = user_id);
```

---

## New Shared Service: Agenda Manager

Create a centralized edge function that any interface can call:

### `supabase/functions/agenda-manager/index.ts`

```typescript
// Operations:
// - initialize: Parse agenda from context, create items in DB
// - start_item: Mark item as in_progress
// - complete_item: Mark current item complete, advance to next
// - pause_for_tangent: Mark current as paused, store user query
// - resume: Resume paused item
// - get_status: Get current agenda state for thread
// - get_resume_hint: Get "Getting back to..." text if paused

serve(async (req) => {
  const { operation, threadId, userId, ...params } = await req.json();
  
  switch (operation) {
    case 'initialize':
      // Parse agenda text into items, insert into conversation_agenda
      const items = parseAgendaFromContext(params.context);
      await supabase.from('conversation_agenda').insert(
        items.map((text, idx) => ({
          thread_id: threadId,
          user_id: userId,
          item_index: idx,
          item_text: text,
          status: 'pending',
          source: params.source || 'scheduled_call'
        }))
      );
      return { success: true, itemCount: items.length };
      
    case 'start_item':
      await supabase.from('conversation_agenda')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('item_index', params.itemIndex);
      return { success: true };
      
    case 'pause_for_tangent':
      await supabase.from('conversation_agenda')
        .update({ 
          status: 'paused', 
          paused_for: params.userQuery,
          paused_at: new Date().toISOString()
        })
        .eq('thread_id', threadId)
        .eq('status', 'in_progress');
      return { success: true };
      
    case 'resume':
      await supabase.from('conversation_agenda')
        .update({ status: 'in_progress', paused_for: null, paused_at: null })
        .eq('thread_id', threadId)
        .eq('status', 'paused');
      return { success: true };
      
    case 'get_resume_hint':
      const { data: paused } = await supabase
        .from('conversation_agenda')
        .select('item_text')
        .eq('thread_id', threadId)
        .eq('status', 'paused')
        .single();
      return { 
        hint: paused ? `Getting back to: ${paused.item_text}` : null 
      };
      
    case 'get_status':
      const { data: items } = await supabase
        .from('conversation_agenda')
        .select('*')
        .eq('thread_id', threadId)
        .order('item_index');
      return {
        items,
        completed: items?.filter(i => i.status === 'completed').length || 0,
        total: items?.length || 0,
        currentItem: items?.find(i => i.status === 'in_progress' || i.status === 'paused'),
        isPaused: items?.some(i => i.status === 'paused') || false
      };
  }
});
```

---

## Integration Points

### 1. Twilio Bridge (`twilio-realtime-bridge`)

Replace in-memory `AgendaManager` class with calls to the shared service:

```typescript
// Instead of: agendaManager = new AgendaManager(session.agenda)
await fetch(`${SUPABASE_URL}/functions/v1/agenda-manager`, {
  method: 'POST',
  body: JSON.stringify({
    operation: 'initialize',
    threadId,
    userId,
    context: session.context,
    source: 'scheduled_call'
  })
});

// Instead of: agendaManager.pauseForQuery(userTranscript)
await fetch(`${SUPABASE_URL}/functions/v1/agenda-manager`, {
  method: 'POST',
  body: JSON.stringify({
    operation: 'pause_for_tangent',
    threadId,
    userId,
    userQuery: userTranscript
  })
});
```

### 2. WebRTC Voice (`RealtimeVoiceAssistant.ts`)

Add agenda awareness to in-app voice:

```typescript
// On connect, check if thread has an active agenda
const { data } = await supabase.functions.invoke('agenda-manager', {
  body: { operation: 'get_status', threadId: this.threadId, userId: this.userId }
});

if (data.items?.length > 0) {
  console.log(`[AGENDA] Thread has ${data.total} agenda items, ${data.completed} completed`);
  // Include in session context for AI awareness
}

// When processing user speech that seems like a tangent
if (detectTangent(userTranscript)) {
  await supabase.functions.invoke('agenda-manager', {
    body: { operation: 'pause_for_tangent', threadId, userId, userQuery: userTranscript }
  });
}
```

### 3. Chat (`hybrid-assistant-api`)

Add agenda context to chat responses:

```typescript
// At start of processing, get agenda status
const agendaStatus = await fetch(`${supabaseUrl}/functions/v1/agenda-manager`, {
  method: 'POST',
  body: JSON.stringify({ operation: 'get_status', threadId, userId })
}).then(r => r.json());

// Include in system prompt if agenda exists
if (agendaStatus.items?.length > 0) {
  systemPrompt += `\n\nCONVERSATION AGENDA:\n${
    agendaStatus.items.map(i => `- [${i.status}] ${i.item_text}`).join('\n')
  }`;
  
  if (agendaStatus.isPaused) {
    systemPrompt += `\n\nNote: User went on a tangent. When appropriate, guide back to: "${agendaStatus.currentItem?.item_text}"`;
  }
}
```

---

## Files to Create/Modify

| File | Action | Changes |
|------|--------|---------|
| Database | Create | `conversation_agenda` table with indexes and RLS |
| `supabase/functions/agenda-manager/index.ts` | Create | Centralized agenda operations service |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Modify | Replace in-memory AgendaManager with service calls |
| `src/utils/RealtimeVoiceAssistant.ts` | Modify | Add agenda awareness via service calls |
| `supabase/functions/hybrid-assistant-api/index.ts` | Modify | Include agenda context in chat responses |

---

## Benefits

1. **Consistent Experience**: All modes know about conversation agenda
2. **Cross-Session Persistence**: Agenda survives disconnects/reconnects
3. **Cross-Mode Continuity**: Start on phone, continue on chat, finish on WebRTC - agenda follows
4. **Debugging**: Query `conversation_agenda` to see exactly what was discussed
5. **Future-Proof**: New interfaces just call the same service

---

## Migration Path

1. Create `conversation_agenda` table
2. Create `agenda-manager` edge function
3. Update Twilio bridge to use shared service (keep in-memory class as fallback initially)
4. Add agenda awareness to WebRTC voice
5. Add agenda context to chat
6. Remove legacy in-memory AgendaManager class once stable

