import { generateToken, validateConfig } from './tokenGenerator.ts';

export interface ClientOptions {
  gatewayOrigin: string;
  seed: string;
  windowSeconds?: number;
  clock?: () => number;
  fetchImpl?: typeof fetch;
}

// Construct per session. The seed must be provisioned by your application.
export function createMutationClient(options: ClientOptions) {
  const { seed, windowSeconds = 20, clock = Date.now, fetchImpl = fetch } = options;
  validateConfig(seed, windowSeconds);
  const origin = new URL(options.gatewayOrigin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('gatewayOrigin must be an HTTP(S) origin');
  }
  return async function mutationFetch(path: string, init?: RequestInit): Promise<Response> {
    // Accept only canonical logical API paths; never arbitrary destinations.
    const [pathname] = path.split('?');
    if (!pathname.startsWith('/api/v1/') || /[%\\#\s]/.test(pathname) || path.includes('#') || pathname.slice(8).split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Expected a canonical /api/v1/<route> path');
    }
    const token = await generateToken(seed, clock(), windowSeconds);
    const target = new URL('/api/v1/' + token + '/' + path.slice(8), origin);
    // Never retry mutations automatically; never follow upstream redirects.
    return fetchImpl(target, { ...init, redirect: 'error', cache: 'no-store' });
  };
}
