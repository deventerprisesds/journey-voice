
# Plan: Split Twilio Voice Functions into Deployable Modules

## Problem Analysis

The `twilio-realtime-bridge` (3,011 lines) and `twilio-voice-handler` (1,538 lines) edge functions are failing to deploy due to "Bundle generation timed out" errors. The bundling process cannot handle files of this size within Supabase's deployment pipeline limits.

## Solution: Modular Architecture

Split the monolithic functions into smaller, focused edge functions that can deploy successfully. The main WebSocket handler will remain as a thin orchestration layer that imports from shared modules and delegates to specialized edge functions via HTTP.

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                    twilio-realtime-bridge                        │
│                    (~800 lines - WebSocket core)                 │
├─────────────────────────────────────────────────────────────────┤
│  • WebSocket handling (Twilio ↔ OpenAI)                         │
│  • Audio routing (no transcoding - moved to shared)             │
│  • Event dispatch to specialized modules                        │
└───────────────┬─────────────────────────────────────────────────┘
                │ imports from
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    _shared/ modules                              │
├─────────────────────────────────────────────────────────────────┤
│  config.ts (existing - 130 lines)                               │
│  audio-codec.ts (NEW - ~100 lines)                              │
│  tool-definitions.ts (NEW - ~200 lines)                         │
│  persona.ts (NEW - ~150 lines)                                  │
└─────────────────────────────────────────────────────────────────┘
                │ calls via HTTP
                ▼
┌─────────────────────────────────────────────────────────────────┐
│              Specialized Edge Functions (existing)               │
├─────────────────────────────────────────────────────────────────┤
│  execute-tool           (tool execution)                        │
│  elevenlabs-tts         (TTS generation)                        │
│  rag-context-retrieval  (knowledge base)                        │
│  agenda-manager         (call agenda state)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Implementation

### Step 1: Create `_shared/audio-codec.ts` (~100 lines)
Extract audio transcoding utilities from the bridge:
- G.711 μ-law encoding/decoding tables and functions
- Upsample 8kHz → 24kHz
- Downsample 24kHz → 8kHz
- Base64 ↔ Int16Array conversion
- RMS amplitude calculation

### Step 2: Create `_shared/tool-definitions.ts` (~200 lines)
Extract tool definitions from the bridge:
- All OpenAI function tool schemas (get_tasks, create_task, web_search, hang_up, etc.)
- Exported as a reusable array

### Step 3: Create `_shared/persona.ts` (~150 lines)
Extract persona/instruction generation:
- Default Iris persona string
- `getTimeBasedGreeting()` function
- `getCurrentTimeString()` function
- `generateGreetingForCallType()` function
- `loadUserInstructions()` function

### Step 4: Create `_shared/session-manager.ts` (~150 lines)
Extract session management logic:
- PreConnectSession interface
- `storePreConnectSession()` function
- `getPreConnectSession()` function

### Step 5: Create `_shared/agenda-wrapper.ts` (~100 lines)
Extract agenda management wrappers:
- SharedAgendaManager class (calls agenda-manager edge function)
- AgendaManager legacy class (in-memory fallback)

### Step 6: Refactor `twilio-realtime-bridge/index.ts` (~800 lines)
Slim down to core WebSocket orchestration:
- Import all utilities from `_shared/`
- Keep only WebSocket event handlers
- Keep audio pipeline routing
- Keep OpenAI message handling
- Remove all extracted utility code

### Step 7: Refactor `twilio-voice-handler/index.ts` (~600 lines)
Apply same pattern:
- Import shared modules
- Keep TwiML generation and routing logic
- Remove duplicated utility code

## Files to Create/Modify

| File | Action | Est. Lines |
|------|--------|------------|
| `supabase/functions/_shared/audio-codec.ts` | CREATE | ~100 |
| `supabase/functions/_shared/tool-definitions.ts` | CREATE | ~200 |
| `supabase/functions/_shared/persona.ts` | CREATE | ~150 |
| `supabase/functions/_shared/session-manager.ts` | CREATE | ~150 |
| `supabase/functions/_shared/agenda-wrapper.ts` | CREATE | ~100 |
| `supabase/functions/twilio-realtime-bridge/index.ts` | REFACTOR | ~800 |
| `supabase/functions/twilio-voice-handler/index.ts` | REFACTOR | ~600 |

## Deployment Strategy

1. Deploy shared modules first (they don't deploy independently - they're bundled)
2. Deploy refactored `twilio-voice-handler` (smaller, simpler)
3. Deploy refactored `twilio-realtime-bridge` (main bridge)
4. Test with a phone call to verify functionality

## Risk Mitigation

- **Import resolution**: Supabase bundler should handle `../_shared/` imports correctly (already works for `config.ts`)
- **Incremental testing**: Deploy handler first (simpler) to validate the approach
- **Rollback plan**: Keep original files backed up in git history
- **Feature parity**: All functionality preserved, just reorganized

## Technical Details

### Audio Codec Module Extract
From lines 13-120 of the current bridge, extract:
```typescript
// _shared/audio-codec.ts
export const mulawToLinearTable: Int16Array = new Int16Array(256);
// ... initialization code ...
export function decodeMulaw(mulawData: Uint8Array): Int16Array { ... }
export function encodeMulaw(pcmData: Int16Array): Uint8Array { ... }
export function upsample8to24(pcm8k: Int16Array): Int16Array { ... }
export function downsample24to8(pcm24k: Int16Array): Int16Array { ... }
export function int16ToBase64(pcmData: Int16Array): string { ... }
export function base64ToInt16(base64: string): Int16Array { ... }
export function calculateRMSAmplitude(pcmData: Int16Array): number { ... }
```

### Tool Definitions Module Extract
From lines 448-642 of the current bridge, extract:
```typescript
// _shared/tool-definitions.ts
export function getToolDefinitions(): any[] {
  return [
    { type: "function", name: "get_tasks", ... },
    { type: "function", name: "create_task", ... },
    // ... all other tools ...
  ];
}
```

### Persona Module Extract
From lines 122-420 of the current bridge, extract:
```typescript
// _shared/persona.ts
export const DEFAULT_IRIS_PERSONA = `You are Iris...`;
export function getTimeBasedGreeting(timezone: string): string { ... }
export function getCurrentTimeString(timezone: string): string { ... }
export function generateGreetingForCallType(...): string { ... }
export async function loadUserInstructions(...): Promise<string> { ... }
```

## Success Criteria

1. Both edge functions deploy without timeout errors
2. Phone calls (inbound and outbound) work as before
3. All tool calls function correctly
4. ElevenLabs TTS integration unchanged
5. Pre-connect session caching still works
6. Agenda management persists across calls

## Timeline Estimate

- Shared modules creation: 4 tool calls
- Bridge refactor: 2 tool calls
- Handler refactor: 1 tool call
- Deployment and testing: 1 tool call

Total: ~8 implementation steps
