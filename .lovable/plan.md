

# Fix: Display Full ElevenLabs Voice ID in Settings

## Problem

The custom voice list in VoiceAssistantSettings.tsx truncates voice IDs to only 12 characters using `voice.id.substring(0, 12)`, making it impossible to see or copy the full ID.

**Current display:** `T720RsqorTx4...`  
**Full ID:** `T720RsqorTx4ZZWohrNN`

## Solution

Update the custom voice list to show the full voice ID and add a copy-to-clipboard button for convenience.

## Implementation

### File: `src/components/VoiceAssistantSettings.tsx`

**Change 1: Add clipboard import (line 13)**
Add `Copy, Check` to the existing lucide-react import.

**Change 2: Add copy state (around line 126)**
Add state to track which voice ID was copied:
```typescript
const [copiedVoiceId, setCopiedVoiceId] = useState<string | null>(null);
```

**Change 3: Add copy handler function**
```typescript
const handleCopyVoiceId = async (voiceId: string) => {
  await navigator.clipboard.writeText(voiceId);
  setCopiedVoiceId(voiceId);
  setTimeout(() => setCopiedVoiceId(null), 2000);
};
```

**Change 4: Update custom voice display (lines 591-607)**

Replace the truncated display with the full ID and a copy button:

```typescript
{customVoices.map((voice) => (
  <div
    key={voice.id}
    className="flex items-center justify-between rounded-md border px-3 py-2"
  >
    <div className="flex-1 min-w-0">
      <span className="font-medium">{voice.name}</span>
      <div className="flex items-center gap-1 mt-0.5">
        <code className="text-xs text-muted-foreground font-mono break-all">
          {voice.id}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={() => handleCopyVoiceId(voice.id)}
          title="Copy voice ID"
        >
          {copiedVoiceId === voice.id ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
    </div>
    <Button
      variant="ghost"
      size="icon"
      onClick={() => handleRemoveCustomVoice(voice.id)}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  </div>
))}
```

## Result

| Before | After |
|--------|-------|
| `T720RsqorTx4...` (truncated, not copyable) | `T720RsqorTx4ZZWohrNN` (full ID with copy button) |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/VoiceAssistantSettings.tsx` | Add Copy/Check icons, copy state, copy handler, and update custom voice display to show full ID |

