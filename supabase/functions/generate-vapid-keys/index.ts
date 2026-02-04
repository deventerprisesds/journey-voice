import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

async function generateVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  // Export both keys in JWK format for reliable extraction
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  
  // The 'd' parameter in private JWK is the 32-byte private key scalar (base64url)
  const privateKeyBase64Url = privateKeyJwk.d!;
  
  // For public key, we need raw format: 0x04 || X || Y (65 bytes total)
  // Decode x and y from base64url, prepend 0x04, encode back to base64url
  const xBytes = base64urlToBytes(publicKeyJwk.x!);
  const yBytes = base64urlToBytes(publicKeyJwk.y!);
  
  // Construct raw public key: 0x04 + X (32 bytes) + Y (32 bytes)
  const rawPublicKey = new Uint8Array(65);
  rawPublicKey[0] = 0x04;
  rawPublicKey.set(xBytes, 1);
  rawPublicKey.set(yBytes, 33);
  
  const publicKeyBase64Url = bytesToBase64url(rawPublicKey);

  // Log for debugging
  console.log('Generated keys:', {
    publicKeyLength: publicKeyBase64Url.length,
    privateKeyLength: privateKeyBase64Url.length,
    xParam: publicKeyJwk.x,
    yParam: publicKeyJwk.y,
    dParam: privateKeyBase64Url,
    dMatchesX: privateKeyBase64Url === publicKeyJwk.x,
    dMatchesY: privateKeyBase64Url === publicKeyJwk.y
  });

  return { 
    publicKey: publicKeyBase64Url, 
    privateKey: privateKeyBase64Url 
  };
}

function base64urlToBytes(base64url: string): Uint8Array {
  // Add padding if needed
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
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
    
    // Verify the private key doesn't match public key suffix
    const publicKeySuffix = keys.publicKey.slice(-43);
    const keysAreDistinct = keys.privateKey !== publicKeySuffix;
    
    return new Response(JSON.stringify({
      message: keysAreDistinct 
        ? "Valid VAPID keys generated! Copy these to your Supabase secrets"
        : "WARNING: Key generation issue detected",
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      validation: {
        publicKeyChars: keys.publicKey.length,
        privateKeyChars: keys.privateKey.length,
        keysAreDistinct,
        expectedPublicLength: "~87 chars",
        expectedPrivateLength: "~43 chars"
      },
      instructions: [
        "1. Copy VAPID_PUBLIC_KEY value",
        "2. Go to Supabase > Settings > Edge Functions > Secrets",
        "3. Update VAPID_PUBLIC_KEY with the new value",
        "4. Update VAPID_PRIVATE_KEY with the new value",
        "5. Toggle push notifications OFF then ON in the app"
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
