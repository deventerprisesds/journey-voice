/**
 * Audio Codec Utilities for Twilio ↔ OpenAI Audio Processing
 * 
 * Handles bidirectional audio conversion:
 * - G.711 μ-law (8kHz) from Twilio ↔ PCM16 (24kHz) for OpenAI Realtime API
 */

// G.711 μ-law decoding table (8-bit -> 16-bit)
export const mulawToLinearTable: Int16Array = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let sample = ~i;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  let mantissa = sample & 0x0f;
  mantissa = (mantissa << 1) + 33;
  mantissa = mantissa << exponent;
  mantissa -= 33;
  mulawToLinearTable[i] = sign !== 0 ? -mantissa : mantissa;
}

/**
 * Decode G.711 μ-law to PCM16
 */
export function decodeMulaw(mulawData: Uint8Array): Int16Array {
  const pcm = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    pcm[i] = mulawToLinearTable[mulawData[i]];
  }
  return pcm;
}

/**
 * Encode PCM16 to G.711 μ-law
 */
export function encodeMulaw(pcmData: Int16Array): Uint8Array {
  const mulaw = new Uint8Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    let sample = pcmData[i];
    const sign = sample < 0 ? 0x80 : 0;
    sample = Math.abs(sample);
    if (sample > 32635) sample = 32635;
    sample = sample + 0x84;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return mulaw;
}

/**
 * Upsample 8kHz → 24kHz (3x) with linear interpolation
 */
export function upsample8to24(pcm8k: Int16Array): Int16Array {
  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length; i++) {
    const current = pcm8k[i];
    const next = i < pcm8k.length - 1 ? pcm8k[i + 1] : current;
    const idx = i * 3;
    pcm24k[idx] = current;
    pcm24k[idx + 1] = Math.round(current + (next - current) / 3);
    pcm24k[idx + 2] = Math.round(current + (2 * (next - current)) / 3);
  }
  return pcm24k;
}

/**
 * Downsample 24kHz → 8kHz (1/3) with averaging
 */
export function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length; i++) {
    const idx = i * 3;
    pcm8k[i] = Math.round((pcm24k[idx] + pcm24k[idx + 1] + pcm24k[idx + 2]) / 3);
  }
  return pcm8k;
}

/**
 * Convert Int16Array to Base64 string
 */
export function int16ToBase64(pcmData: Int16Array): string {
  const uint8 = new Uint8Array(pcmData.buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to Int16Array
 */
export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/**
 * Calculate RMS (Root Mean Square) amplitude from PCM audio data
 * Used for echo detection and real barge-in detection
 */
export function calculateRMSAmplitude(pcmData: Int16Array): number {
  if (pcmData.length === 0) return 0;
  
  let sum = 0;
  let nonZeroCount = 0;
  let maxVal = 0;
  
  for (let i = 0; i < pcmData.length; i++) {
    const val = pcmData[i];
    if (val !== 0) nonZeroCount++;
    if (Math.abs(val) > maxVal) maxVal = Math.abs(val);
    sum += val * val;
  }
  
  const rms = Math.sqrt(sum / pcmData.length);
  
  // Diagnostic: Log if RMS is 0 but we have non-zero samples (indicates bug)
  if (rms === 0 && nonZeroCount > 0) {
    console.log(`[AMPLITUDE-BUG] ⚠️ RMS=0 but nonZeroCount=${nonZeroCount}, maxVal=${maxVal}`);
  }
  
  return rms;
}

/**
 * Convert base64 μ-law audio to chunks for Twilio streaming
 * Returns array of base64 chunks, each ~20ms at 8kHz
 */
export function chunkMulawForTwilio(audioBase64: string, chunkSize: number = 160): string[] {
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  const chunks: string[] = [];
  
  for (let i = 0; i < audioBytes.length; i += chunkSize) {
    const chunk = audioBytes.slice(i, i + chunkSize);
    chunks.push(btoa(String.fromCharCode(...chunk)));
  }
  
  return chunks;
}
