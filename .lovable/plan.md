

# Fix Invalid VAPID Private Key

## Summary

The push subscription toggle failure is caused by an **invalid VAPID private key**. The key generation utility incorrectly extracted the private key from PKCS8 format, resulting in a truncated key that happens to match the tail of the public key. This causes cryptographic failures when `web-push` attempts to sign push messages.

---

## Root Cause Analysis

### What Went Wrong

The `generate-vapid-keys` function used this logic:
```typescript
const privateKeyBytes = new Uint8Array(privateKeyBuffer).slice(-32);
```

This assumes the raw 32-byte private key is at the end of the PKCS8 structure, but PKCS8 wrapping includes headers, OID identifiers, and sometimes padding that makes this extraction unreliable.

### Evidence

- **Public Key** (65 bytes decoded): `BFTRyPyY3SHyUwoXERMEXOH1kfgB0iIEHmuP1u6rp3V-_pVsp8upDKZDojFvUkztL021Y8v_EdWeK9boXKl67QU`
- **Private Key** (should be 32 bytes): `_pVsp8upDKZDojFvUkztL021Y8v_EdWeK9boXKl67QU`

The private key exactly matches the last 43 characters of the public key - this is cryptographically impossible for a valid key pair. The public key contains the x and y coordinates of a curve point, while the private key is a scalar multiplier. They cannot share byte sequences.

---

## Solution

### Step 1: Fix the Key Generation Function

Update `supabase/functions/generate-vapid-keys/index.ts` to properly extract the raw private key:

```typescript
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

async function generateVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  // Export public key in raw format (65 bytes: 0x04 + 32-byte X + 32-byte Y)
  const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  
  // Export private key in JWK format to get the raw 'd' parameter
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  
  // The 'd' parameter in JWK is already base64url-encoded 32-byte private key
  const privateKeyBase64Url = privateKeyJwk.d;
  
  // Convert public key to URL-safe base64
  const publicKeyBase64Url = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { 
    publicKey: publicKeyBase64Url, 
    privateKey: privateKeyBase64Url 
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const keys = await generateVapidKeys();
    
    return new Response(JSON.stringify({
      message: "Copy these keys to your Supabase secrets",
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      keyLengths: {
        publicKeyChars: keys.publicKey.length,
        privateKeyChars: keys.privateKey.length,
        note: "Public should be ~87 chars, Private should be ~43 chars"
      },
      instructions: [
        "1. Copy VAPID_PUBLIC_KEY value",
        "2. Go to Supabase > Settings > Edge Functions > Add secret",
        "3. Name: VAPID_PUBLIC_KEY, Value: [paste]",
        "4. Repeat for VAPID_PRIVATE_KEY"
      ]
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error generating VAPID keys:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate VAPID keys',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

### Step 2: Generate New Valid Keys

After deployment, call the function to get properly generated keys:
```
GET https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/generate-vapid-keys
```

### Step 3: Update Both Secrets

Replace both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` with the newly generated values.

### Step 4: Clear Browser Push Subscription

Users may need to:
1. Toggle push notifications OFF in Settings
2. Toggle push notifications ON again

This re-subscribes with the new valid public key.

---

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/generate-vapid-keys/index.ts` | Update to use JWK export for private key |
| **Secrets** | Update `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` after regeneration |

---

## Technical Details

### Why JWK Export Works

The JWK (JSON Web Key) format explicitly separates the key components:
- `x`: The x-coordinate of the public key point (base64url)
- `y`: The y-coordinate of the public key point (base64url)
- `d`: The raw private key scalar (base64url) - exactly 32 bytes

This is more reliable than trying to parse PKCS8 binary structure.

### Validation

After regeneration, verify:
- Public key is approximately 87 characters
- Private key is approximately 43 characters
- Private key does NOT appear in public key

