

# Replace Ring Tone Audio File

## Summary

Replace the current placeholder ring tone with the user's uploaded ringback tone audio file.

---

## Changes

### 1. Copy Audio File

Copy the uploaded file to the public sounds directory:

| Source | Destination |
|--------|-------------|
| `user-uploads://cell_phone_tone_ringback_3_times-77262.mp3` | `public/sounds/ring-tone.mp3` |

This replaces the existing `ring-tone.m4a` file.

---

### 2. Update PhoneDialer Reference

**File**: `src/components/CommsConsole/PhoneDialer.tsx`

Update the audio file extension from `.m4a` to `.mp3`:

```typescript
// Line ~78: Change this
ringAudioRef.current = new Audio('/sounds/ring-tone.m4a');

// To this
ringAudioRef.current = new Audio('/sounds/ring-tone.mp3');
```

---

## Files

| File | Action |
|------|--------|
| `public/sounds/ring-tone.mp3` | Create (copy from upload) |
| `public/sounds/ring-tone.m4a` | Can be deleted (optional cleanup) |
| `src/components/CommsConsole/PhoneDialer.tsx` | Update audio path |

