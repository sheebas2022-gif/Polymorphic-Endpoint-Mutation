import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createBackend() {
  return http.createServer(async (request, response) => {
    if (request.url.split('?')[0] !== '/api/v1/checkout') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 1048576) { response.writeHead(413).end(); return; }
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true, method: request.method, path: request.url, body }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createBackend().listen(9000, '127.0.0.1', () => console.log('Mock backend: http://127.0.0.1:9000'));
}
