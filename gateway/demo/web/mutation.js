// Browser counterpart of client-sdk/src/tokenGenerator.ts; tested against it.
export async function requestPath(seed, nowMs, windowSeconds, route, mode = 'current') {
  if (!['current','previous','invalid','expired','future','missing'].includes(mode)) throw new Error('Unknown token mode');
  if (mode === 'missing') return '/api/v1/' + route;
  const shifts = {current:0,previous:-1,expired:-3,future:1,invalid:0};
  const token = mode === 'invalid' ? 'zzzzzzzz' : await tokenFor(seed, nowMs + shifts[mode]*windowSeconds*1000, windowSeconds);
  return '/api/v1/' + token + '/' + route;
}
export async function tokenFor(seed, nowMs, windowSeconds = 20) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const interval = Math.floor(nowMs/(windowSeconds*1000));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(interval)));
  return [...new Uint8Array(signature).slice(0,4)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
