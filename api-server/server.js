import http from 'node:http';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createEventAPI } from './events.js';

export async function createTaskServer({ dataFile = resolve('data/tasks.json') } = {}) {
  const eventAPI = await createEventAPI(resolve(dirname(dataFile), 'bookings.json'));
  let tasks = [];
  try {
    tasks = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!Array.isArray(tasks) || tasks.some(task => typeof task.id !== 'string' || typeof task.title !== 'string' || typeof task.done !== 'boolean')) throw new Error('Invalid task data');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot load task data: ${error.message}`); }
  const started = Date.now();
  let queue = Promise.resolve(), requests = 0, writes = 0, failures = 0;
  const recent = [];
  function serialize(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; }
  async function commit(updated) {
    await mkdir(dirname(dataFile), { recursive: true });
    await writeFile(dataFile + '.tmp', JSON.stringify(updated, null, 2), 'utf8');
    await rename(dataFile + '.tmp', dataFile);
    tasks = updated; writes++;
  }
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const begin = performance.now();
    res.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (path === '/internal/status' && req.method === 'GET') {
      const metrics=eventAPI.metrics();
      return json(200, { service: 'Encore booking API', online: true, startedAt: new Date(started).toISOString(), uptimeSeconds: Math.floor((Date.now()-started)/1000), requests, writes:writes+metrics.bookingWrites, failures, taskCount: tasks.length, ...metrics, memoryMB: Math.round(process.memoryUsage().rss/1048576), storage: 'JSON file · atomic writes', recent });
    }
    requests++;
    res.on('finish', () => {
      if (res.statusCode >= 400) failures++;
      recent.unshift({ time: new Date().toISOString(), method: req.method, path: req.url.slice(0, 500), status: res.statusCode, durationMs: Math.round((performance.now()-begin)*100)/100, requestId: String(req.headers['x-demo-request-id'] || '').slice(0,80) });
      if (recent.length > 30) recent.pop();
      console.log(JSON.stringify(recent[0]));
    });
    try {
      if(await eventAPI.handle(req,json,readBody))return;
      if (path === '/api/v1/tasks' && req.method === 'GET') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        const search = (query.get('q') || '').toLowerCase();
        const status = query.get('status') || 'all';
        if (!['all','open','done'].includes(status)) return json(400, { error: 'status must be all, open, or done' });
        return json(200, { tasks: tasks.filter(task => task.title.toLowerCase().includes(search) && (status === 'all' || task.done === (status === 'done'))), servedAt: new Date().toISOString() });
      }
      if (path === '/api/v1/summary' && req.method === 'GET') return json(200, { total: tasks.length, completed: tasks.filter(task => task.done).length, pending: tasks.filter(task => !task.done).length, servedAt: new Date().toISOString() });
      if (path === '/api/v1/preview' && req.method === 'POST') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(400, { error: 'Enter valid JSON' }); }
        if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) return json(400, { error: 'Task titles must contain 1–120 characters' });
        return json(200, { valid: true, normalizedTitle: body.title.trim(), characters: body.title.trim().length, saved: false, message: 'Preview only. POST /tasks to save this task.' });
      }
      // Preserve the existing gateway test harness alongside the real API.
      if (path === '/api/v1/checkout') {
        const body = await readBody(req); return json(200, { ok: true, method: req.method, path: req.url, body });
      }
      const match = /^\/api\/v1\/tasks\/([a-f0-9-]{36})$/.exec(path);
      if (path !== '/api/v1/tasks' && !match) return json(404, { error: 'Route not found' });
      if (!((path === '/api/v1/tasks' && req.method === 'POST') || (match && ['PATCH','DELETE'].includes(req.method)))) return json(405, { error: 'Method not allowed' });
      let body = {};
      if (req.method !== 'DELETE') {
        try { body = JSON.parse(await readBody(req)); } catch (error) { return json(error.status || 400, { error: error.status ? error.message : 'Enter valid JSON' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Expected a JSON object' });
      }
      await serialize(async () => {
        const updated = tasks.map(task => ({ ...task }));
        if (req.method === 'POST') {
          if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) return json(400, { error: 'Task titles must contain 1–120 characters' });
          if (tasks.length >= 250) return json(409, { error: 'This demo supports up to 250 tasks' });
          const task = { id: randomUUID(), title: body.title.trim(), done: false, createdAt: new Date().toISOString() };
          updated.unshift(task); await commit(updated); return json(201, { task });
        }
        const index = updated.findIndex(task => task.id === match[1]);
        if (index === -1) return json(404, { error: 'Task not found' });
        if (req.method === 'DELETE') { updated.splice(index,1); await commit(updated); return json(200, { deleted: match[1] }); }
        if (typeof body.done !== 'boolean') return json(400, { error: 'done must be true or false' });
        updated[index].done = body.done; await commit(updated); return json(200, { task: updated[index] });
      });
    } catch (error) {
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'The server could not save your change. Please try again.' });
      else res.end();
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw Object.assign(new Error('Request body exceeds 16 KiB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createTaskServer({ dataFile: process.env.TASK_DATA_FILE || resolve('data/tasks.json') });
  server.listen(9000, '127.0.0.1', () => console.log('Task API running on http://127.0.0.1:9000; data persists in data/tasks.json'));
}
