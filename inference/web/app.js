const $ = id => document.getElementById(id);
const STORE = 'floptrace:receipts:v2';
let latest = null;
function note(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}
async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'HTTP ' + response.status);
  return body;
}
function receipts() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function saveReceipt(value) {
  try { localStorage.setItem(STORE, JSON.stringify([value, ...receipts()].slice(0, 30))); }
  catch { note('Completed; browser storage unavailable. Export this receipt to keep it.', true); }
  renderHistory();
}
function renderHistory() {
  const entries = receipts();
  $('count').textContent = String(entries.length);
  const root = $('history');
  root.replaceChildren();
  if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No local receipts yet.'; root.append(empty); return; }
  for (const receipt of entries) {
    const row = document.createElement('div'); row.className = 'historyrow';
    const values = [
      new Date(receipt.createdAt).toLocaleString(),
      receipt.model || 'Unknown model',
      (receipt.requestSha256 || '').slice(0, 24) + '…',
      'NOT VERIFIED'
    ];
    for (let i = 0; i < values.length; i++) {
      const cell = document.createElement(i === 2 ? 'code' : 'span');
      if (i === 3) cell.className = 'status';
      cell.textContent = values[i]; row.append(cell);
    }
    root.append(row);
  }
}
async function loadStatus() {
  try {
    const data = await request('/api/status');
    $('access').textContent = data.keyConfigured ? 'KEY CONFIGURED' : 'DISCOVERY ONLY';
  } catch { $('access').textContent = 'UNAVAILABLE'; }
}
async function loadAgents() {
  const select = $('did'), root = $('profiles');
  root.replaceChildren();
  try {
    const res = await request('/api/agents');
    for (const agent of res.data || []) {
      const option = document.createElement('option'); option.value = agent.did;
      option.textContent = agent.name + ' · ' + agent.did.slice(0, 20) + '…'; select.append(option);
      const card = document.createElement('article'); card.className = 'profile';
      const title = document.createElement('h3'); title.textContent = agent.name;
      const did = document.createElement('code'); did.textContent = agent.did;
      const hint = document.createElement('small');
      hint.textContent = agent.ed25519 ? 'ED25519 FORMAT VALID · OWNERSHIP UNVERIFIED' : 'INVALID DID FORMAT';
      card.append(title, did, hint); root.append(card);
    }
    if (res.data?.length) select.value = res.data[0].did;
  } catch (error) {
    const div = document.createElement('div'); div.className = 'empty';
    div.textContent = 'Agent profiles unavailable: ' + error.message; root.append(div);
  }
}
async function loadModels() {
  const model = $('model'); model.replaceChildren();
  $('gateway').textContent = 'CHECKING';
  try {
    const res = await request('/api/models');
    const items = Array.isArray(res.data) ? res.data : [];
    for (const item of items) {
      if (typeof item.id !== 'string') continue;
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.id; model.append(option);
    }
    $('gateway').textContent = items.length ? 'ONLINE · ' + items.length + ' MODELS' : 'EMPTY CATALOGUE';
    if (!items.length) note('Gateway returned no advertised models.', true);
  } catch (error) {
    $('gateway').textContent = 'OFFLINE';
    const option = document.createElement('option'); option.value = ''; option.textContent = 'Model discovery unavailable'; model.append(option);
    note('Gateway model discovery failed: ' + error.message, true);
  }
}
$('refresh').addEventListener('click', loadModels);
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('run');
  button.disabled = true;
  note('Waiting for FLOP Gateway. No on-chain verification is performed.');
  $('output').textContent = 'Request in progress…';
  try {
    const result = await request('/api/infer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: $('did').value || null,
        model: $('model').value,
        system: $('system').value,
        prompt: $('prompt').value.trim()
      })
    });
    $('output').textContent = result.output;
    latest = result.receipt;
    $('digest').textContent = result.receipt.outputSha256.slice(0, 24) + '…';
    $('export').disabled = false;
    saveReceipt(result.receipt);
    note('Gateway response received. Local hashes saved. Protocol proof NOT VERIFIED.');
  } catch (error) {
    $('output').textContent = 'No verified inference result. ' + error.message;
    note('Inference failed: ' + error.message, true);
  } finally { button.disabled = false; }
});
$('export').addEventListener('click', () => {
  if (!latest) return;
  const file = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a'); link.href = url; link.download = 'floptrace-receipt.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
});
$('clear').addEventListener('click', () => {
  if (confirm('Delete local FLOPTRACE receipts from this browser?')) {
    localStorage.removeItem(STORE); renderHistory();
  }
});
renderHistory();
await Promise.all([loadStatus(), loadModels(), loadAgents()]);
