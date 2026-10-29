const $ = id => document.getElementById(id);
let state = null, clockOffset = 0, online = false, polling = false;
let selected = null, activeTab = 'response', selectedID = null;
let lastClientEvent = 0, serverSession;
function text(id, value) { $(id).textContent = value; }
function duration(value) { return value < 0.01 ? '<0.01 ms' : `${value.toFixed(2)} ms`; }
function setConnection(ok) {
  online = ok;
  $('connection').classList.toggle('offline', !ok);
  text('connection-text', ok ? 'Gateway connected' : 'Gateway disconnected');
  if (!ok) { text('current-token', '••••••••'); text('countdown', '—'); }
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/demo/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
    state = await response.json();
    if(serverSession!==state.started){lastClientEvent=0;serverSession=state.started;}
    clockOffset = state.serverTime - Date.now();
    setConnection(true);
    text('current-token', state.tokens.current); text('previous-token', state.tokens.previous);
    text('window-label', `${state.windowSeconds}-second window`); text('interval-label', `Window ${state.interval.toLocaleString()}`);
    for (const [id, key] of [['total','total'], ['forwarded','forwarded'], ['blocked','blocked'], ['backend','backendResponses']]) text(`stat-${id}`, state.counts[key]);
    const latestClient=state.events.find(event=>event.source==='client');
    if($('follow-client').checked && latestClient && latestClient.id!==lastClientEvent){lastClientEvent=latestClient.id;inspect(latestClient);}
    renderActivity(); tick();
  } catch { setConnection(false); }
  finally { polling = false; }
}
function tick() {
  if (!state || !online) return;
  const remaining = Math.max(0, state.nextRotation - Date.now() - clockOffset);
  text('countdown', `${Math.ceil(remaining / 1000)}s`);
  $('rotation-progress').value = remaining / (state.windowSeconds * 1000) * 100;
}
function inspect(event) {
  selected = event; selectedID = event.id;
  const forwarded = event.backendAttempted, responded = event.backendResponded;
  text('journey-status', !forwarded ? 'BLOCKED AT GATEWAY' : responded ? 'BACKEND RESPONDED' : 'UPSTREAM UNAVAILABLE');
  $('journey-status').className = `pill ${!forwarded ? 'blocked' : responded ? 'success' : 'error'}`;
  $('stage-client').className = 'stage passed';
  $('stage-gateway').className = `stage ${forwarded ? 'passed' : 'blocked'}`;
  $('stage-backend').className = `stage ${responded ? 'passed' : forwarded ? 'blocked' : 'inactive'}`;
  $('connector-one').className = 'connector passed';
  $('connector-two').className = `connector ${forwarded ? 'passed' : 'blocked'}`;
  text('client-detail', `${event.method} · ${event.source==='client'?'page '+event.pageId.slice(0,8):'test request'}`);
  text('gateway-detail', forwarded ? 'Token accepted · path rewritten' : 'Route rejected · HTTP 404');
  text('backend-detail', responded ? `Responded with HTTP ${event.status}` : forwarded ? 'No upstream response' : 'Not invoked');
  text('journey-explanation', !forwarded ? 'Stopped at the perimeter. The route failed validation, so the backend was never invoked.' : responded ? 'Token accepted. The gateway stripped the token and received a real response from the backend.' : 'The route passed validation, but the proxy could not obtain a backend response. Check the backend process.');
  text('trace-incoming', event.incoming); text('trace-forwarded', event.forwarded || 'Not forwarded — blocked at gateway');
  text('response-meta', `HTTP ${event.status} · ${duration(event.durationMs)} server`);
  renderInspector();
}
function renderInspector(body) {
  let content;
  if (activeTab === 'trace') content = selected ? JSON.stringify(selected, null, 2) : '// Select a request to inspect its server trace.';
  else {
    body ??= selected ? selected.responseBody : undefined;
    if (body === undefined) content = '// Select a client request to view its recorded response.';
    else { try { content = JSON.stringify(JSON.parse(body), null, 2); } catch { content = body; } if(selected?.responseTruncated)content+='\n// Preview truncated at 8 KiB.'; }
  }
  text('response-body', content);
}
function renderActivity() {
  if (!state) return;
  const filter = $('filter').value;
  const events = state.events.filter(event => filter === 'all' || (filter === 'forwarded' ? event.backendAttempted : !event.backendAttempted));
  const signature = `${state.started}:${state.counts.total}:${filter}:${selectedID}`;
  if ($('activity-rows').dataset.signature === signature) return;
  $('activity-rows').dataset.signature = signature;
  $('activity-rows').replaceChildren();
  for (const event of events) {
    const row = document.createElement('tr');
    if (event.id === selectedID) row.className = 'selected';
    const values = [new Date(event.time).toLocaleTimeString([], { hour12: false }), `${event.method} ${event.incoming}`, `${event.status} · ${event.backendAttempted ? 'Forwarded' : 'Blocked'}`, event.backendResponded ? 'Responded' : event.backendAttempted ? 'Unavailable' : 'Not invoked', duration(event.durationMs)];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      const child = document.createElement(index === 1 ? 'code' : 'span'); child.textContent = value;
      if (index === 2) child.className = `pill ${event.backendAttempted ? event.backendResponded ? 'success' : 'error' : 'blocked'}`;
      cell.append(child); row.append(cell);
      if(index===1){const source=document.createElement('span');source.className='source-detail';source.textContent=event.source==='client'?`Client website · page ${event.pageId.slice(0,8)}`:event.source;cell.append(source);}
    });
    const cell = document.createElement('td'), button = document.createElement('button');
    button.className = 'inspect-button'; button.textContent = '↗'; button.setAttribute('aria-label', `Inspect request ${event.id}`);
    cell.append(button); row.append(cell);
    row.addEventListener('click', () => {
      $('follow-client').checked=false;
      inspect(event); renderActivity();
      $('journey-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    });
    $('activity-rows').append(row);
  }
  $('activity-empty').hidden = events.length > 0;
  if (!events.length) {
    $('activity-empty').querySelector('strong').textContent = filter !== 'all' ? 'No requests match this filter' : 'A clear view of every request';
    $('activity-empty').querySelector('p').textContent = filter !== 'all' ? 'Choose All requests or make a request from the client.' : 'Open the client website to generate activity. This monitor only observes.';
  }
  text('activity-count', `${events.length} shown · ${state.counts.total} requests since gateway start`);
}
$('filter').addEventListener('change', renderActivity);
for (const tab of ['response','trace']) $('tab-' + tab).addEventListener('click', () => {
  activeTab = tab;
  for (const name of ['response','trace']) { $('tab-' + name).classList.toggle('selected', name === tab); $('tab-' + name).setAttribute('aria-selected', String(name === tab)); }
  $('response-panel').setAttribute('aria-labelledby', 'tab-' + tab); renderInspector();
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('response-body').textContent); text('copy', 'Copied'); setTimeout(() => text('copy', 'Copy'), 1500); }
  catch { text('copy', 'Select text to copy'); }
});
$('export').addEventListener('click', () => {
  if (!state) return;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), counts: state.counts, events: state.events }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'flux-request-activity.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => { document.querySelectorAll('nav a').forEach(item => item.classList.toggle('active', item === link)); }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
await refresh();
setInterval(refresh, 1000);
setInterval(tick, 100);
