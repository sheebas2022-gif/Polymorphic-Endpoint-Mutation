import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutationClient } from '../client-sdk/src/index.ts';
import { generateToken } from '../client-sdk/src/tokenGenerator.ts';

test('live SDK → Go gateway → mock backend', { skip: !process.env.E2E_ORIGIN }, async () => {
  const seed = process.env.MUTATION_SEED!;
  const origin = process.env.E2E_ORIGIN!;
  const windowSeconds = Number(process.env.WINDOW_SECONDS || 30);
  const client = createMutationClient({ gatewayOrigin: origin, seed, windowSeconds });
  const response = await client('/api/v1/checkout?currency=INR', { method: 'POST', body: 'order=123' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, method: 'POST', path: '/api/v1/checkout?currency=INR', body: 'order=123' });
  assert.equal((await fetch(origin + '/api/v1/checkout')).status, 404);
  const expired = await generateToken(seed, Date.now() - 3 * windowSeconds * 1000, windowSeconds);
  assert.equal((await fetch(`${origin}/api/v1/${expired}/checkout`)).status, 404);
});
