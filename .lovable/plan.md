
# Plan: Allow Typing While Processing

## Problem
When you send a chat message, both the text input AND the send button become disabled. You want to be able to type your next message while waiting for the AI response.

## Solution
Remove the `isLoading` check from the text input's `disabled` prop, while keeping it on the send button. This way:
- You can type your next message while waiting
- You can't accidentally send until the current response finishes
- Enter key submission is already blocked by the `handleSubmit` logic

## Files to Update

### 1. TextInputBar.tsx (CommsConsole)
**Line 69** - Remove `isLoading` from textarea disabled prop

Current:
```tsx
disabled={disabled || isLoading}
```

Change to:
```tsx
disabled={disabled}
```

### 2. ChatInterface.tsx (Sheet Chat)
**Line 172** - Remove `disabled` entirely from input

Current:
```tsx
disabled={isLoading}
```

Change to:
```tsx
// Remove disabled prop entirely
```

## Summary

| File | Line | Change |
|------|------|--------|
| `src/components/CommsConsole/TextInputBar.tsx` | 69 | Remove `isLoading` from disabled |
| `src/components/ChatInterface.tsx` | 172 | Remove `disabled={isLoading}` |

## Result
- Text input stays enabled while AI responds
- Send button remains disabled during processing (prevents double-send)
- Enter key won't send while processing (existing logic handles this)
- Better UX for preparing follow-up messages
