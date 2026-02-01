

# Fix: Chat Timestamp and Copy Button Layout

## Current Issue

The copy button is positioned with `absolute` positioning outside the bubble at `-right-7` which doesn't work reliably and requires hover (not mobile-friendly). The timestamp positioning is also not aligned correctly.

## Your Requirements

1. **User messages (your messages)**: Timestamp + copy icon should be **below and to the RIGHT** of the bubble
2. **Assistant messages (other person)**: Timestamp + copy icon should be **below and to the LEFT** of the bubble
3. Copy icon should be **beside the timestamp** (not hidden, always visible)
4. Use the same copy icon style as shown in the screenshot (small, subtle)

## Visual Layout

```
Assistant message:
┌─────────────────────┐
│ Hello, how can I    │
│ help you today?     │
└─────────────────────┘
2m ago [📋]

User message:
              ┌─────────────────────┐
              │ Show me my tasks    │
              └─────────────────────┘
                        [📋] Just now
```

## Code Changes

**File: `src/components/CommsConsole/TranscriptScroll.tsx`**

| Change | Description |
|--------|-------------|
| Remove absolute copy button | Delete lines 135-152 (copy button inside bubble) |
| Update timestamp section | Replace with a flex row containing timestamp + copy button |
| Alignment | User messages: `justify-end` (right). Assistant: `justify-start` (left) |
| Copy button visibility | Always visible (remove `opacity-0 group-hover:opacity-100`) |

### New timestamp/copy row structure:

```tsx
{/* Timestamp + Copy button row - below bubble */}
{message.created_at && !isSystem && (
  <div className={cn(
    'flex items-center gap-1.5 mt-0.5 px-1',
    isUser ? 'justify-end' : 'justify-start'
  )}>
    {/* For user: copy icon first, then timestamp */}
    {/* For assistant: timestamp first, then copy icon */}
    {isUser ? (
      <>
        <button
          onClick={() => handleCopy(message.content || '', message.id || String(index))}
          className="p-0.5 rounded hover:bg-muted/60 transition-colors"
          title="Copy message"
        >
          {copiedId === (message.id || String(index)) ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground/50" />
          )}
        </button>
        <span className="text-[10px] text-muted-foreground/60">
          {formatRelativeTime(message.created_at)}
        </span>
      </>
    ) : (
      <>
        <span className="text-[10px] text-muted-foreground/60">
          {formatRelativeTime(message.created_at)}
        </span>
        <button
          onClick={() => handleCopy(message.content || '', message.id || String(index))}
          className="p-0.5 rounded hover:bg-muted/60 transition-colors"
          title="Copy message"
        >
          {copiedId === (message.id || String(index)) ? (
            <Check className="w-3 h-3 text-green-500" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground/50" />
          )}
        </button>
      </>
    )}
  </div>
)}
```

## Result

| Message Type | Timestamp Position | Copy Icon Position |
|--------------|-------------------|-------------------|
| User (yours) | Bottom-right | Left of timestamp |
| Assistant | Bottom-left | Right of timestamp |
| System | No timestamp/copy | N/A |

Copy icon is always visible and works on tap for mobile.

