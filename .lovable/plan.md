

# Consolidated Fix Plan: Comms Console - All Issues

## Overview

This plan addresses all identified issues in one implementation pass:
- Mobile sidebar not appearing (button does nothing)
- Text chat failing (wrong assistant ID)
- Phone calls failing (missing backend action)
- Phone dialer missing features (no tabs, agent display)
- Mobile responsiveness (viewport not filling properly)

---

## Issue 1: Mobile Sidebar Not Appearing

**Root Cause**: The `AssistantSidebar` is completely hidden on mobile with `{!isMobile && <AssistantSidebar />}`. The toggle button changes state but has no visible effect since nothing is rendered.

**Fix**: Add a Sheet (slide-out drawer) for mobile users.

**File: `src/components/CommsConsole/CommsConsole.tsx`**
- Import Sheet components from `@/components/ui/sheet`
- Add `isMobileSidebarOpen` state
- Render Sheet containing sidebar content when on mobile
- Connect toggle button to open/close the drawer

**File: `src/contexts/CommsConsoleContext.tsx`**
- Add `isMobileSidebarOpen: boolean` to context
- Add `setMobileSidebarOpen: (open: boolean) => void` to context

**File: `src/components/CommsConsole/AssistantHeader.tsx`**
- Update toggle button to call `setMobileSidebarOpen(true)` on mobile

---

## Issue 2: Text Chat Fails

**Root Cause**: `sendMessage` passes `currentAssistant?.id` (e.g., `'mock-iris-id'`) instead of the OpenAI assistant ID.

**Error**: `Invalid 'assistant_id': 'mock-iris-id'. Expected an ID that begins with 'asst_'.`

**File: `src/contexts/CommsConsoleContext.tsx`**
- Line 231: Change `assistantId: currentAssistant?.id` to `assistantId: currentAssistant?.openai_assistant_id || undefined`

---

## Issue 3: Phone Calls Fail

**Root Cause**: The edge function does not handle `action: 'initiate-outbound-call'`.

**Error**: `Unknown action: initiate-outbound-call`

**File: `supabase/functions/twilio-voice-handler/index.ts`**
- Add new action handler for `initiate-outbound-call`
- Use Twilio REST API to make outbound call
- From: TWILIO_PHONE_NUMBER (env var)
- To: User's phone (from profiles table or request)
- Connect call to `twilio-realtime-bridge` with agent context

---

## Issue 4: Phone Dialer Redesign

**Current State**: Basic keypad with phone number input field

**Requested Features**:
1. Three-tab navigation: Keypad | Recents | Contacts (agents)
2. Agent name display as header (not phone number input)
3. Twilio number shown as subtitle
4. Android-style dark theme aesthetic
5. In-call UI with Mute/Speaker/End buttons

**File: `src/components/CommsConsole/PhoneDialer.tsx`** (complete rewrite)

New structure:
```
+----------------------------------+
|         Iris Chase               |  <- Agent name (large)
|    +1 866-xxx-xxxx               |  <- Twilio number
+----------------------------------+
|                                  |
|         [Keypad Grid]            |
|         1  2  3                  |
|         4  5  6                  |
|         7  8  9                  |
|         *  0  #                  |
|                                  |
|      [Green Call Button]         |
|                                  |
+----------------------------------+
|  Keypad  |  Recents  | Contacts  |  <- Tab bar
+----------------------------------+
```

**Contacts Tab**: Shows list of available assistants - tap to select before calling
**Recents Tab**: Shows recent call history with agents
**Keypad Tab**: Traditional dial pad (for DTMF tones during call)

---

## Issue 5: Mobile Responsiveness

**Problems**: Layout doesn't fill mobile screen, content appears centered with whitespace

**File: `src/pages/CommsHome.tsx`**
- Use `min-h-[100dvh]` for dynamic viewport height (mobile browser chrome)
- Add `overscroll-behavior: none` to prevent pull-to-refresh
- Ensure safe-area-inset padding for notched devices

**File: `src/components/CommsConsole/CommsConsole.tsx`**
- Ensure flex layout fills available space
- Minimum 44px touch targets on all buttons
- Proper spacing for thumb-reachable UI elements

---

## Files Summary

| File | Action | Changes |
|------|--------|---------|
| `src/contexts/CommsConsoleContext.tsx` | Modify | Add mobile sidebar state + fix assistant ID |
| `src/components/CommsConsole/CommsConsole.tsx` | Modify | Add Sheet for mobile sidebar + responsive fixes |
| `src/components/CommsConsole/AssistantHeader.tsx` | Modify | Connect toggle to mobile drawer |
| `src/components/CommsConsole/PhoneDialer.tsx` | Rewrite | Android-style dialer with tabs |
| `src/pages/CommsHome.tsx` | Modify | Mobile viewport fixes |
| `supabase/functions/twilio-voice-handler/index.ts` | Modify | Add outbound call action |

---

## Implementation Order

1. **Context updates** - Add mobile sidebar state + fix assistant ID (CommsConsoleContext)
2. **Mobile sidebar drawer** - Add Sheet component (CommsConsole + AssistantHeader)
3. **Mobile responsiveness** - Viewport fixes (CommsHome)
4. **Backend outbound call** - Add action handler (twilio-voice-handler)
5. **Phone dialer redesign** - Android-style UI (PhoneDialer)

---

## Technical Notes

### Mobile Sidebar Behavior
- Desktop: Inline sidebar, toggle expands/collapses
- Mobile: Sheet slides in from left, toggle opens drawer, tap outside dismisses

### Twilio Outbound Call Flow
1. User taps Call button in PhoneDialer
2. Frontend sends `{ action: 'initiate-outbound-call', userId, agentId }`
3. Edge function looks up user's phone from profiles
4. Twilio REST API initiates call FROM Twilio number TO user's phone
5. When answered, Twilio connects to realtime bridge with agent context

### Sheet Component Usage
The Sheet from `@/components/ui/sheet` provides the slide-out drawer:
- `SheetContent side="left"` for left-side drawer
- Automatically handles backdrop and dismiss on outside click

