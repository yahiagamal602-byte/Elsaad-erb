import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass the isolated Electron user-data directory as the first argument.');

const targets = await (await fetch('http://127.0.0.1:9345/json/list')).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer window is not available on the expected DevTools endpoint.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
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

async function waitForModalClose() {
  await evaluate(`new Promise((resolve, reject) => {
    if (!document.querySelector('#asset-editor-modal')) return resolve(true);
    const observer = new MutationObserver(() => {
      if (!document.querySelector('#asset-editor-modal')) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Asset editor did not close after save')); }, 20000);
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`), true, `Missing UI control ${selector}`);
}

async function setField(selector, value, eventType = 'input') {
  assert.equal(await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.value = ${JSON.stringify(String(value))};
    element.dispatchEvent(new Event(${JSON.stringify(eventType)}, { bubbles: true }));
    return true;
  })()`), true, `Missing form field ${selector}`);
}

function seedAccounts() {
  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  const account = (code, name, type) => {
    database.prepare('INSERT OR IGNORE INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run(code, name, type);
    return Number(database.prepare('SELECT id FROM accounts WHERE code = ?').get(code).id);
  };
  const linked = {
    asset: account('E2E-ASSET-VEH', 'أصل سيارات اختبار', 'asset'),
    accumulated: account('E2E-ACCUM-VEH', 'مجمع إهلاك اختبار', 'asset'),
    expense: account('E2E-EXP-VEH', 'مصروف إهلاك اختبار', 'expense'),
  };
  database.close();
  return linked;
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await evaluate(`window.confirm = () => true; window.alert = (message) => { window.__assetAlerts = [...(window.__assetAlerts ?? []), String(message)]; };`);
const linked = seedAccounts();
await waitFor('#login-form');
await setField('#login-form [name="username"]', 'admin');
await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
await click('#login-form button[type="submit"]');
await waitFor('.app-shell');

await click('[data-asset-page="asset-groups"]');
await waitFor('[data-action="asset-group-add"]');
await click('[data-action="asset-group-add"]');
await setField('[data-form="asset-group"] [name="code"]', 'E2E-VEH');
await setField('[data-form="asset-group"] [name="name"]', 'مجموعة سيارات اختبار');
await setField('[data-form="asset-group"] [name="nameEn"]', 'E2E vehicles');
await setField('[data-form="asset-group"] [name="assetAccountId"]', linked.asset, 'change');
await setField('[data-form="asset-group"] [name="accumulatedDepreciationAccountId"]', linked.accumulated, 'change');
await setField('[data-form="asset-group"] [name="depreciationExpenseAccountId"]', linked.expense, 'change');
await click('[data-form="asset-group"] button[type="submit"]');
await waitFor('[data-asset-group-row]');
await click('[data-action="asset-group-edit"]');
assert.equal(await evaluate(`document.querySelector('[data-form="asset-group"] [name="name"]').value`), 'مجموعة سيارات اختبار');
await setField('[data-form="asset-group"] [name="name"]', 'مجموعة سيارات معدلة');
await click('[data-form="asset-group"] button[type="submit"]');
await waitForModalClose();
await click('[data-action="asset-group-edit"]');
assert.equal(await evaluate(`document.querySelector('[data-form="asset-group"] [name="name"]').value`), 'مجموعة سيارات معدلة');
await click('[data-action="asset-editor-close"]');

await click('[data-asset-page="asset-codes"]');
await waitFor('[data-action="asset-add"]');
await click('[data-action="asset-add"]');
await setField('[data-form="asset"] [name="code"]', 'E2E-CAR');
await setField('[data-form="asset"] [name="name"]', 'سيارة اختبار');
await setField('[data-form="asset"] [name="nameEn"]', 'Test vehicle');
const groupSelection = await evaluate(`(() => {
  const select = document.querySelector('[data-form="asset"] [name="groupId"]');
  return { value: select?.value ?? '', options: [...(select?.options ?? [])].map((option) => ({ value: option.value, text: option.textContent })) };
})()`);
assert.ok(groupSelection.value, `Asset group selector has no selected group: ${JSON.stringify(groupSelection)}`);
const groupId = groupSelection.value;
await setField('[data-form="asset"] [name="groupId"]', groupId, 'change');
assert.equal(await evaluate(`document.querySelector('[data-form="asset"] [data-group-code]').value`), 'E2E-VEH');
await setField('[data-form="asset"] [name="purchaseDate"]', '2025-01-01');
await setField('[data-form="asset"] [name="purchaseValue"]', '12100');
await setField('[data-form="asset"] [name="salvageValue"]', '100');
await setField('[data-form="asset"] [name="usefulLifeYears"]', '1');
await setField('[data-form="asset"] [name="status"]', 'active', 'change');
await click('[data-form="asset"] button[type="submit"]');
await waitFor('[data-action="asset-edit"]');
await click('[data-action="asset-edit"]');
assert.equal(await evaluate(`document.querySelector('[data-form="asset"] [name="purchaseValue"]').value`), '12100');
await setField('[data-form="asset"] [name="notes"]', 'تعديل وإعادة فتح');
await click('[data-form="asset"] button[type="submit"]');
await waitForModalClose();
await click('[data-action="asset-edit"]');
assert.equal(await evaluate(`document.querySelector('[data-form="asset"] [name="notes"]').value`), 'تعديل وإعادة فتح');
await click('[data-action="asset-editor-close"]');

await click('[data-asset-page="depreciation"]');
await waitFor('[data-form="asset-depreciation-period"]');
await setField('[data-form="asset-depreciation-period"] [name="from"]', '2025-01-01');
await setField('[data-form="asset-depreciation-period"] [name="to"]', '2025-12-31');
await click('[data-form="asset-depreciation-period"] button[type="submit"]');
await waitFor('[data-action="asset-depreciation-post"]:not([disabled])');
assert.match(await evaluate(`document.querySelector('.depreciation-table').innerText`), /12,000|١٢٬٠٠٠|12000/);
await click('[data-action="asset-depreciation-post"]');
await waitFor('[data-action="asset-depreciation-run"]');
await click('[data-action="asset-depreciation-run"]');
assert.match(await evaluate(`document.querySelector('#asset-run-title').innerText`), /DEP-202512/);
await click('[data-action="asset-editor-close"]');
await evaluate(`window.print = () => { window.__assetPrintCalls = (window.__assetPrintCalls ?? 0) + 1; };`);
await click('[data-action="asset-depreciation-print"]');
assert.equal(await evaluate('window.__assetPrintCalls'), 1);
await click('[data-action="asset-depreciation-pdf"]');
await evaluate(`new Promise((resolve, reject) => {
  const check = () => (window.__assetAlerts ?? []).some((message) => message.includes('تم تصدير تقرير الإهلاك'));
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (check()) { clearInterval(timer); resolve(true); }
    else if (Date.now() - startedAt > 30000) { clearInterval(timer); reject(new Error('Timed out waiting for asset PDF export')); }
  }, 50);
})`);
const exportedPdfPath = join(userData, 'screenshots', 'asset-depreciation-test.pdf');
const exportedPdf = readFileSync(exportedPdfPath);
assert.equal(exportedPdf.subarray(0, 4).toString(), '%PDF');
assert.ok(statSync(exportedPdfPath).size > 1000);

const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
const posted = database.prepare(`SELECT runs.number, runs.journal_entry_id, COUNT(lines.asset_id) AS asset_count,
  SUM(CAST(lines.amount AS REAL)) AS total FROM asset_depreciation_runs runs JOIN asset_depreciation_lines lines ON lines.run_id = runs.id
  WHERE runs.starts_on = '2025-01-01' AND runs.ends_on = '2025-12-31' GROUP BY runs.id`).get();
assert.ok(posted);
assert.equal(posted.asset_count, 1);
assert.equal(posted.total, 12000);
const journal = database.prepare(`SELECT SUM(CAST(debit AS REAL)) AS debit, SUM(CAST(credit AS REAL)) AS credit
  FROM journal_lines WHERE entry_id = ?`).get(posted.journal_entry_id);
assert.equal(journal.debit, 12000);
assert.equal(journal.credit, 12000);
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
database.close();
assert.deepEqual(consoleErrors, []);
socket.close();
console.log(`Asset Electron flow passed; PDF: ${exportedPdfPath}; depreciation journal ${posted.journal_entry_id} is balanced.`);