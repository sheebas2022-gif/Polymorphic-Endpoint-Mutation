import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { generateToken } from '../client-sdk/src/tokenGenerator.ts';
import { createMutationClient } from '../client-sdk/src/index.ts';

const seed = '0123456789abcdef0123456789abcdef';

test('shared Go/TypeScript vector and native HMAC agreement', async () => {
  assert.equal(await generateToken(seed, 1700000000000, 60), '6f12b8ed');
  for (const interval of [0, 1, 123456, 28333333]) {
    assert.equal(await generateToken(seed, interval * 30000), createHmac('sha256', seed).update(String(interval)).digest('hex').slice(0, 8));
  }
});

test('token remains stable within a window and changes at boundary', async () => {
  assert.equal(await generateToken(seed, 30000), await generateToken(seed, 59999));
  assert.notEqual(await generateToken(seed, 59999), await generateToken(seed, 60000));
});

test('wrapper preserves query, body and authorization, recomputes each call', async () => {
  let now = 60000;
  const seen: string[] = [];
  const client = createMutationClient({ gatewayOrigin: 'https://gateway.example', seed, clock: () => now,
    fetchImpl: (async (url, init) => {
      seen.push(String(url));
      assert.equal(init?.method, 'POST');
      assert.equal(init?.body, '{"order":123}');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer example');
      assert.equal(init?.redirect, 'error');
      return new Response('ok');
    }) as typeof fetch,
  });
  const init = { method: 'POST', body: '{"order":123}', headers: { Authorization: 'Bearer example' } };
  await client('/api/v1/checkout?currency=INR', init);
  now = 120000;
  await client('/api/v1/checkout?currency=INR', init);
  assert.equal(seen[0], `https://gateway.example/api/v1/${await generateToken(seed, 60000)}/checkout?currency=INR`);
  assert.notEqual(seen[0], seen[1]);
});

test('rejects malformed configuration and routes before sending', async () => {
  assert.throws(() => createMutationClient({ gatewayOrigin: 'https://example.com', seed: 'short' }));
  assert.throws(() => createMutationClient({ gatewayOrigin: 'https://example.com/path', seed }));
  await assert.rejects(generateToken(seed, 0, 0));
  const client = createMutationClient({ gatewayOrigin: 'https://example.com', seed,
    fetchImpl: (async () => { throw new Error('must not send'); }) as typeof fetch });
  for (const path of ['https://evil.example/api/v1/a', '//evil.example/api/v1/a', '/api/v1/', '/api/v1/../checkout', '/api/v1/%2fcheckout', '/api/v1/a#fragment']) {
    await assert.rejects(client(path), /canonical/);
  }
});
