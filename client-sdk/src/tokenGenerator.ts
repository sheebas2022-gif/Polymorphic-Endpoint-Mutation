export function validateConfig(seed: string, windowSeconds: number): void {
  if (new TextEncoder().encode(seed).length < 32) throw new Error('Seed must contain at least 32 UTF-8 bytes');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) throw new Error('Window must be 1..86400 whole seconds');
}

export async function generateToken(seed: string, nowMs = Date.now(), windowSeconds = 20): Promise<string> {
  validateConfig(seed, windowSeconds);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('Time must be a nonnegative safe integer in milliseconds');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const interval = Math.floor(nowMs / (windowSeconds * 1000));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(interval)));
  return Array.from(new Uint8Array(signature).slice(0, 4), byte => byte.toString(16).padStart(2, '0')).join('');
}
