import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass the isolated Electron user-data directory as the first argument.');
const targets = await (await fetch('http://127.0.0.1:9352/json/list')).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer window is not available on the expected DevTools endpoint.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});

function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

async function waitFor(selector) {
  await evaluate(`new Promise((resolve, reject) => {
    const read = () => document.querySelector(${JSON.stringify(selector)});
    if (read()) return resolve(true);
    const observer = new MutationObserver(() => { if (read()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for ' + ${JSON.stringify(selector)})); }, 20000);
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function setField(selector, value, eventType = 'input') {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event(${JSON.stringify(eventType)}, { bubbles: true })); return true; })()`), true, `Missing field ${selector}`);
}

function seedLedger() {
  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  database.exec('PRAGMA foreign_keys = ON');
  const addAccount = (code, name, type) => {
    database.prepare('INSERT OR IGNORE INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run(code, name, type);
    return Number(database.prepare('SELECT id FROM accounts WHERE code = ?').get(code).id);
  };
  const cashId = addAccount('RPT-CASH', 'نقدية اختبار التقارير', 'asset');
  const capitalId = addAccount('RPT-CAPITAL', 'رأس مال اختبار التقارير', 'equity');
  const insertEntry = database.prepare('INSERT INTO journal_entries (reference, entry_date, description) VALUES (?, ?, ?)');
  const insertLine = database.prepare('INSERT INTO journal_lines (entry_id, line_order, account_id, debit, credit) VALUES (?, ?, ?, ?, ?)');
  const postBalanced = (date, value) => {
    const entry = insertEntry.run(`RPT-${date}`, date, 'قيد اختبار التقارير');
    const id = Number(entry.lastInsertRowid);
    insertLine.run(id, 1, cashId, value, '0');
    insertLine.run(id, 2, capitalId, '0', value);
  };
  postBalanced('2025-12-31', '1000');
  postBalanced('2026-01-15', '250');
  postBalanced('2026-02-01', '500');
  database.close();
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await evaluate(`window.alert = (message) => { window.__reportAlerts = [...(window.__reportAlerts ?? []), String(message)]; }; window.print = () => { window.__reportPrintCalls = (window.__reportPrintCalls ?? 0) + 1; };`);
seedLedger();
await waitFor('#login-form');
await setField('#login-form [name="username"]', 'admin');
await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
await click('#login-form button[type="submit"]');
await waitFor('.app-shell');
await click('[data-page="reports"]');
await waitFor('.reports-page');
await waitFor('.report-preview');

assert.match(await evaluate(`document.querySelector('.reports-page').innerText`), /التقارير والطباعة/);
assert.equal(await evaluate(`Boolean(document.querySelector('[data-form="report-filters"] [name="from"]'))`), false);
assert.equal(await evaluate(`document.querySelectorAll('.report-group').length`), 10);
await setField('#report-search', 'ميزان');
assert.ok((await evaluate(`document.querySelector('#reports-library-body').innerText`)).includes('ميزان المراجعة'));
await click('[data-report-key="trial-balance"]');
await waitFor('[data-form="report-filters"] [name="to"]');
assert.equal(await evaluate(`Boolean(document.querySelector('#report-filter-form input[name=from]'))`), false);
await setField('[data-form="report-filters"] [name="to"]', '2026-01-31');
await click('[data-form="report-filters"] button[type="submit"]');
await evaluate(`new Promise((resolve, reject) => {
  const ready = () => document.querySelector('[data-report-preview]')?.innerText.includes('2026-01-31');
  if (ready()) return resolve(true);
  const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Trial balance did not refresh for the selected date')); }, 20000);
})`);
const previewText = await evaluate(`document.querySelector('[data-report-preview]').innerText`);
assert.match(previewText, /1250/);
assert.doesNotMatch(previewText, /1750/);
assert.match(previewText, /إجمالي المدين[\s\S]*1250/);
assert.equal(await evaluate(`document.querySelectorAll('.report-print-document__table tbody tr').length`), 0);

await click('[data-report-favorite="trial-balance"]');
assert.ok(await evaluate(`JSON.parse(localStorage.getItem('elsaad.reports.favorites') ?? '[]').includes('trial-balance')`));
await click('[data-action="report-print"]');
assert.equal(await evaluate('window.__reportPrintCalls'), 1);
assert.equal(await evaluate(`document.querySelectorAll('.report-print-document__table tbody tr').length`), 2);

await click('[data-action="report-pdf"]');
await click('[data-action="report-excel"]');
await evaluate(`new Promise((resolve, reject) => {
  const ready = () => (window.__reportAlerts ?? []).filter((message) => message.includes('تم تصدير التقرير')).length >= 2;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (ready()) { clearInterval(timer); resolve(true); }
    else if (Date.now() - startedAt > 30000) { clearInterval(timer); reject(new Error('Report PDF/CSV export did not finish')); }
  }, 50);
})`);

const outputDirectory = join(userData, 'screenshots');
const pdf = readFileSync(join(outputDirectory, 'reports-test.pdf'));
const csv = readFileSync(join(outputDirectory, 'reports-test.csv'), 'utf8');
assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
assert.match(csv, /ميزان المراجعة/);
assert.match(csv, /1250/);
assert.ok(statSync(join(outputDirectory, 'reports-test.pdf')).size > 1000);
const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
database.close();
assert.deepEqual(errors, []);
socket.close();
console.log('Reports Electron flow passed: real trial-balance filters, print preview, balanced totals, PDF, and CSV exports.');