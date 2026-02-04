import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// ECDSA P-256 curve for VAPID keys
async function generateVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  // Export keys in raw format
  const publicKeyBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  // Extract the 32-byte private key from PKCS8 format (last 32 bytes)
  const privateKeyBytes = new Uint8Array(privateKeyBuffer).slice(-32);

  // Convert to URL-safe base64
  const publicKey = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const privateKey = btoa(String.fromCharCode(...privateKeyBytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return { publicKey, privateKey };
}

serve(async () => {
  const keys = await generateVapidKeys();
  
  return new Response(JSON.stringify({
    message: "Copy these keys to your Supabase secrets",
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    instructions: [
      "1. Copy VAPID_PUBLIC_KEY value",
      "2. Go to Supabase > Settings > Edge Functions > Add secret",
      "3. Name: VAPID_PUBLIC_KEY, Value: [paste]",
      "4. Repeat for VAPID_PRIVATE_KEY"
    ]
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
