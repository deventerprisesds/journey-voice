// G.711 μ-law encoding/decoding for Twilio audio
// Twilio uses 8kHz μ-law, OpenAI uses 24kHz PCM16

const MULAW_BIAS = 0x84;
const MULAW_MAX = 32635;

// μ-law decoding table
const mulawDecodeTable = new Int16Array([
  -32124, -31100, -30076, -29052, -28028, -27004, -25980, -24956,
  -23932, -22908, -21884, -20860, -19836, -18812, -17788, -16764,
  -15996, -15484, -14972, -14460, -13948, -13436, -12924, -12412,
  -11900, -11388, -10876, -10364, -9852, -9340, -8828, -8316,
  -7932, -7676, -7420, -7164, -6908, -6652, -6396, -6140,
  -5884, -5628, -5372, -5116, -4860, -4604, -4348, -4092,
  -3900, -3772, -3644, -3516, -3388, -3260, -3132, -3004,
  -2876, -2748, -2620, -2492, -2364, -2236, -2108, -1980,
  -1884, -1820, -1756, -1692, -1628, -1564, -1500, -1436,
  -1372, -1308, -1244, -1180, -1116, -1052, -988, -924,
  -876, -844, -812, -780, -748, -716, -684, -652,
  -620, -588, -556, -524, -492, -460, -428, -396,
  -372, -356, -340, -324, -308, -292, -276, -260,
  -244, -228, -212, -196, -180, -164, -148, -132,
  -120, -112, -104, -96, -88, -80, -72, -64,
  -56, -48, -40, -32, -24, -16, -8, 0,
  32124, 31100, 30076, 29052, 28028, 27004, 25980, 24956,
  23932, 22908, 21884, 20860, 19836, 18812, 17788, 16764,
  15996, 15484, 14972, 14460, 13948, 13436, 12924, 12412,
  11900, 11388, 10876, 10364, 9852, 9340, 8828, 8316,
  7932, 7676, 7420, 7164, 6908, 6652, 6396, 6140,
  5884, 5628, 5372, 5116, 4860, 4604, 4348, 4092,
  3900, 3772, 3644, 3516, 3388, 3260, 3132, 3004,
  2876, 2748, 2620, 2492, 2364, 2236, 2108, 1980,
  1884, 1820, 1756, 1692, 1628, 1564, 1500, 1436,
  1372, 1308, 1244, 1180, 1116, 1052, 988, 924,
  876, 844, 812, 780, 748, 716, 684, 652,
  620, 588, 556, 524, 492, 460, 428, 396,
  372, 356, 340, 324, 308, 292, 276, 260,
  244, 228, 212, 196, 180, 164, 148, 132,
  120, 112, 104, 96, 88, 80, 72, 64,
  56, 48, 40, 32, 24, 16, 8, 0
]);

// Decode G.711 μ-law to PCM16
export function decodeMulaw(mulawData: Uint8Array): Int16Array {
  const pcmData = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    pcmData[i] = mulawDecodeTable[mulawData[i]];
  }
  return pcmData;
}

// Encode PCM16 to G.711 μ-law
export function encodeMulaw(pcmData: Int16Array): Uint8Array {
  const mulawData = new Uint8Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    mulawData[i] = linearToMulaw(pcmData[i]);
  }
  return mulawData;
}

function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;
  sample += MULAW_BIAS;
  
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa);
  return mulawByte & 0xFF;
}

// Upsample 8kHz to 24kHz (3x) using linear interpolation
export function upsample8to24(pcm8k: Int16Array): Int16Array {
  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length; i++) {
    const curr = pcm8k[i];
    const next = i < pcm8k.length - 1 ? pcm8k[i + 1] : curr;
    const outIdx = i * 3;
    pcm24k[outIdx] = curr;
    pcm24k[outIdx + 1] = Math.round(curr + (next - curr) / 3);
    pcm24k[outIdx + 2] = Math.round(curr + (2 * (next - curr)) / 3);
  }
  return pcm24k;
}

// Downsample 24kHz to 8kHz (pick every 3rd sample)
export function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length; i++) {
    pcm8k[i] = pcm24k[i * 3];
  }
  return pcm8k;
}

// Convert Int16Array to base64 string
export function int16ToBase64(pcmData: Int16Array): string {
  const bytes = new Uint8Array(pcmData.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 string to Int16Array
export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

// Calculate RMS amplitude for echo detection
export function calculateRMSAmplitude(pcmData: Int16Array): number {
  if (pcmData.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcmData.length; i++) {
    sum += pcmData[i] * pcmData[i];
  }
  return Math.sqrt(sum / pcmData.length);
}
