import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass the isolated Electron user-data directory as the first argument.');
const targets = await (await fetch('http://127.0.0.1:9370/json/list')).json();
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

async function waitForRowCount(count) {
  await evaluate(`new Promise((resolve, reject) => {
    const ready = () => document.querySelectorAll('[data-installment-row]').length === ${count};
    if (ready()) return resolve(true);
    const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for ${count} installment rows')); }, 20000);
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function setField(selector, value, eventName = 'input') {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true })); return true; })()`), true, `Missing field ${selector}`);
}

function seedInstallments() {
  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  database.exec('PRAGMA foreign_keys = OFF');
  database.prepare('INSERT INTO customers (id, code, name) VALUES (1, ?, ?)').run('CUS-T', 'عميل التقارير');
  database.prepare('INSERT INTO projects (id, code, name, start_date, status) VALUES (1, ?, ?, ?, ?)').run('PRJ-T', 'مشروع التقارير', '2025-01-01', 'in-progress');
  database.prepare('INSERT INTO property_units (id, project_id, code, name, original_price) VALUES (1, 1, ?, ?, ?), (2, 1, ?, ?, ?)')
    .run('UNIT-1', 'الوحدة الأولى', '1000', 'UNIT-2', 'الوحدة الثانية', '500');
  const insertContract = database.prepare(`INSERT INTO property_contracts
    (id, number, project_id, unit_id, customer_id, contract_date, original_price, discount, fees, down_payment, status)
    VALUES (?, ?, 1, ?, 1, '2025-01-01', '1000', '0', '0', '0', ?)`);
  insertContract.run(1, 'CTR-1', 1, 'approved');
  insertContract.run(2, 'CTR-CANCELLED', 1, 'cancelled');
  insertContract.run(3, 'CTR-2', 2, 'approved');
  const insertInstallment = database.prepare(`INSERT INTO property_installments
    (id, contract_id, frequency, sequence, due_date, description, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertInstallment.run(1, 1, 'monthly', 1, '2025-01-10', 'قسط كامل', '100');
  insertInstallment.run(2, 1, 'monthly', 2, '2025-02-10', 'قسط جزئي', '200');
  insertInstallment.run(3, 1, 'quarterly', 3, '2025-03-10', 'قسط متأخر', '300');
  insertInstallment.run(4, 2, 'monthly', 1, '2025-04-10', 'ملغي', '999');
  insertInstallment.run(5, 3, 'monthly', 1, '2027-01-10', 'قسط وحدة ثانية', '500');
  insertInstallment.run(6, 1, 'annual', 4, '2027-01-10', 'قسط قادم', '80');
  const insertAllocation = database.prepare('INSERT INTO property_receipt_allocations (id, receipt_id, installment_id, amount) VALUES (?, ?, ?, ?)');
  insertAllocation.run(1, 1001, 1, '40');
  insertAllocation.run(2, 1002, 1, '60');
  insertAllocation.run(3, 1003, 2, '50');
  insertAllocation.run(4, 1004, 3, '25');
  database.prepare(`INSERT INTO property_installment_adjustments
    (id, contract_id, installment_id, adjustment_type, amount) VALUES (1, 1, 3, 'broker-commission-offset', '25')`).run();
  database.close();
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await evaluate('window.alert = () => {};');
seedInstallments();
await waitFor('#login-form');
await setField('#login-form [name="username"]', 'admin');
await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
await click('#login-form button[type="submit"]');
await waitFor('.app-shell');
await click('[data-page="installment-reports"]');
await waitFor('.installment-report-page');

await setField('form[data-form="installment-report-filters"] [name="from"]', '2025-01-01');
await setField('form[data-form="installment-report-filters"] [name="to"]', '2027-12-31');
await click('form[data-form="installment-report-filters"] button[type="submit"]');
await waitForRowCount(5);
const initial = await evaluate(`document.querySelector('#installment-report-summary').innerText`);
assert.match(initial, /1180/);
assert.match(initial, /175/);
assert.match(initial, /400/);
assert.match(initial, /980/);
assert.equal(await evaluate(`document.querySelectorAll('[data-installment-row]').length`), 5);
assert.equal(await evaluate(`document.querySelectorAll('.installment-group').length`), 1);

await click('[data-installment-grouping="project"]');
assert.equal(await evaluate(`document.querySelectorAll('.installment-group').length`), 1);
await click('[data-installment-grouping="unit"]');
assert.equal(await evaluate(`document.querySelectorAll('.installment-group').length`), 2);
await setField('[data-installment-search]', 'CUS-T');
assert.equal(await evaluate(`document.querySelectorAll('[data-installment-row]').length`), 5);

await setField('form[data-form="installment-report-filters"] [name="installmentStatus"]', 'overdue', 'change');
await click('form[data-form="installment-report-filters"] button[type="submit"]');
await waitForRowCount(2);
const overdueSummary = await evaluate(`document.querySelector('#installment-report-summary').innerText`);
assert.match(overdueSummary, /400/);
assert.match(await evaluate(`document.querySelector('.installment-status-badge--overdue').innerText`), /متأخر/);

await setField('form[data-form="installment-report-filters"] [name="installmentStatus"]', 'paid', 'change');
await click('form[data-form="installment-report-filters"] button[type="submit"]');
await waitForRowCount(1);
assert.match(await evaluate(`document.querySelector('[data-installment-row]').innerText`), /مسدد بالكامل/);

await setField('form[data-form="installment-report-filters"] [name="installmentStatus"]', 'partial', 'change');
await click('form[data-form="installment-report-filters"] button[type="submit"]');
await waitForRowCount(2);
assert.ok(await evaluate(`document.querySelector('form[data-form="installment-report-filters"] [name="unitId"] option[value="2"]') !== null`));
await click('[data-action="installment-report-exit"]');
await waitFor('.app-shell');
assert.equal(await evaluate(`document.querySelector('.installment-report-page')`), null);

const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 0);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM property_receipts').get().count), 0);
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
database.close();
assert.deepEqual(consoleErrors, []);
socket.close();
console.log('Installment report Electron flow passed: status totals, search, three groupings, filters, exit, and read-only ledger state.');