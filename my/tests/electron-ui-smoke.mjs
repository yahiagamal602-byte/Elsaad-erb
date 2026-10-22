import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass the isolated Electron user-data directory as the first argument.');

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer window is not available on the expected DevTools endpoint.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
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
  const response = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(selector) {
  const expression = `new Promise((resolve, reject) => {
    const read = () => document.querySelector(${JSON.stringify(selector)});
    const initial = read();
    if (initial) return resolve(true);
    const observer = new MutationObserver(() => {
      if (read()) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for ' + ${JSON.stringify(selector)})); }, 20000);
  })`;
  await evaluate(expression);
}

async function click(selector) {
  const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `Missing UI control ${selector}`);
}

async function setField(selector, value, eventType = 'input') {
  const result = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      const desired = Boolean(${JSON.stringify(value)});
      if (element.checked !== desired) element.click();
    } else {
      element.value = ${JSON.stringify(String(value))};
      element.dispatchEvent(new Event(${JSON.stringify(eventType)}, { bubbles: true }));
    }
    return true;
  })()`);
  assert.equal(result, true, `Missing form field ${selector}`);
}

function seedReferenceData() {
  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  database.exec('PRAGMA foreign_keys = ON');
  database.prepare(`INSERT OR IGNORE INTO projects (code, name, start_date, end_date, cost_center, status)
    VALUES (?, ?, ?, ?, ?, ?)`).run('E2E-PROPERTY', 'مشروع اختبار Electron', '2026-01-01', '', 'E2E', 'in-progress');
  database.prepare(`INSERT OR IGNORE INTO customers (code, name, status)
    VALUES (?, ?, 'active')`).run('E2E-CUSTOMER', 'عميل اختبار Electron');
  const projectId = Number(database.prepare('SELECT id FROM projects WHERE code = ?').get('E2E-PROPERTY').id);
  const customerId = Number(database.prepare('SELECT id FROM customers WHERE code = ?').get('E2E-CUSTOMER').id);
  const account = (code, name, type) => {
    database.prepare('INSERT OR IGNORE INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run(code, name, type);
    return Number(database.prepare('SELECT id FROM accounts WHERE code = ?').get(code).id);
  };
  const cashAccountId = account('E2E-CASH', 'خزينة اختبار Electron', 'asset');
  const bankAccountId = account('E2E-BANK', 'بنك اختبار Electron', 'asset');
  const receivableAccountId = account('E2E-AR', 'ذمم اختبار Electron', 'asset');
  const expenseAccountId = account('E2E-EXP', 'مصروف اختبار Electron', 'expense');
  database.prepare(`INSERT OR IGNORE INTO treasury_cash_boxes
    (code, name, account_id, currency, opening_balance, opening_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('E2E-CASH-BOX', 'خزينة اختبار Electron', cashAccountId, 'EGP', '1000000', '2020-01-01', 'active');
  database.prepare(`INSERT OR IGNORE INTO treasury_bank_accounts
    (code, name, account_id, bank_account_number, currency, opening_balance, opening_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('E2E-BANK-ACCOUNT', 'بنك اختبار Electron', bankAccountId, 'E2E-123456', 'EGP', '1000000', '2020-01-01', 'active');
  const cashBoxId = Number(database.prepare('SELECT id FROM treasury_cash_boxes WHERE code = ?').get('E2E-CASH-BOX').id);
  database.close();
  return { projectId, customerId, cashBoxId, receivableAccountId, expenseAccountId };
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
const reference = seedReferenceData();
await waitFor('#login-form');
assert.equal(await evaluate(`document.querySelector('.developer-credit--login .developer-credit__name').textContent`), 'Developed by Mohanda Saad');
assert.equal(await evaluate(`document.querySelector('.developer-credit--login .developer-credit__phones').textContent`), '01014998059 / 01069670339');
await setField('#login-form [name="username"]', 'admin');
await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
await click('#login-form button[type="submit"]');
await waitFor('.app-shell');
assert.equal(await evaluate(`document.querySelector('.developer-credit--dashboard .developer-credit__name').textContent`), 'Developed by Mohanda Saad');
assert.equal(await evaluate(`document.querySelector('.developer-credit--dashboard .developer-credit__phones').textContent`), '01014998059 / 01069670339');

await click('[data-project-view="property-units"]');
await waitFor('#property-unit-search');
await click('[data-action="property-unit-add"]');
await waitFor('[data-form="property-unit"]');
await setField('[data-form="property-unit"] [name="projectId"]', reference.projectId, 'change');
await setField('[data-form="property-unit"] [name="code"]', 'E2E-UNIT');
await setField('[data-form="property-unit"] [name="name"]', 'وحدة اختبار');
await setField('[data-form="property-unit"] [name="floor"]', '3');
await setField('[data-form="property-unit"] [name="area"]', '100');
await setField('[data-form="property-unit"] [name="originalPrice"]', '600000');
await click('[data-form="property-unit"] button[type="submit"]');
await waitFor('[data-property-unit]');
assert.match(await evaluate(`document.querySelector('[data-property-unit]').innerText`), /600,000|٦٠٠/);

await click('[data-project-view="property-contracts"]');
await waitFor('[data-action="property-contract-add"]');
await click('[data-action="property-contract-add"]');
await waitFor('[data-form="property-contract"]');
await setField('[data-form="property-contract"] [name="projectId"]', reference.projectId, 'change');
await setField('[data-form="property-contract"] [name="unitId"]', await evaluate(`document.querySelector('[data-form="property-contract"] [name="unitId"] option:not([value=""])')?.value`), 'change');
await setField('[data-form="property-contract"] [name="customerId"]', reference.customerId, 'change');
await setField('[data-form="property-contract"] [name="contractDate"]', '2026-10-19');
await setField('[data-form="property-contract"] [name="downPaymentDueDate"]', '2026-10-20');
await setField('[data-form="property-contract"] [name="originalPrice"]', '600000');
await setField('[data-form="property-contract"] [name="discount"]', '0');
await setField('[data-form="property-contract"] [name="downPayment"]', '100000');

for (const [frequency, amount, count, date] of [
  ['monthly', '100000', 10, '2026-11-19'],
  ['quarterly', '100000', 1, '2027-01-19'],
  ['semiannual', '100000', 1, '2027-04-19'],
  ['annual', '100000', 1, '2027-10-19'],
]) {
  await setField(`[data-form="property-contract"] [name="${frequency}Amount"]`, amount);
  await setField(`[data-form="property-contract"] [name="${frequency}Count"]`, count);
  await setField(`[data-form="property-contract"] [name="${frequency}FirstDate"]`, date);
}
await click('[data-action="property-free-add"]');
await click('[data-action="property-free-add"]');
const freeRows = await evaluate(`document.querySelectorAll('[data-property-free-payment]').length`);
assert.equal(freeRows, 2);
for (const [index, dueDate] of [[0, '2026-12-19'], [1, '2027-02-19']]) {
  await setField(`[data-property-free-payment]:nth-child(${index + 1}) [name="freeAmount"]`, '50000');
  await setField(`[data-property-free-payment]:nth-child(${index + 1}) [name="freeDueDate"]`, dueDate);
  await setField(`[data-property-free-payment]:nth-child(${index + 1}) [name="freeDescription"]`, `دفعة حرة ${index + 1}`);
}
const planStatus = await evaluate(`document.querySelector('[data-total-frequency="status"]').textContent.trim()`);
const unallocated = await evaluate(`document.querySelector('[data-total-frequency="undistributed"]').textContent.trim()`);
assert.equal(planStatus, 'مكتملة');
assert.match(unallocated, /0/);

const screenshots = join(userData, 'screenshots');
mkdirSync(screenshots, { recursive: true });
const contractScreenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(join(screenshots, 'property-contract.png'), Buffer.from(contractScreenshot.data, 'base64'));
await click('[data-form="property-contract"] button[name="mode"][value="approve"]');
await waitFor('[data-property-contract]');
const contractText = await evaluate(`document.querySelector('[data-property-contract]').innerText`);
assert.match(contractText, /E2E-CUSTOMER|عميل اختبار Electron/);

await click('[data-project-view="property-payments"]');
await waitFor('[data-action="property-payment-select"]');
const contractChoice = await evaluate(`document.querySelector('[data-action="property-payment-select"]').dataset.id`);
await click(`[data-action="property-payment-select"][data-id="${contractChoice}"]`);
await waitFor('[data-form="property-receipt"]');
const counts = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-payment-installment]')];
  const count = (label) => rows.filter((row) => row.children[2].textContent.trim() === label).length;
  return { total: rows.length, monthly: count('شهري'), quarterly: count('ربع سنوي'), semiannual: count('نصف سنوي'), annual: count('سنوي'), free: count('دفعة حرة'), down: count('مقدم') };
})()`);
assert.deepEqual(counts, { total: 16, monthly: 10, quarterly: 1, semiannual: 1, annual: 1, free: 2, down: 1 });

const monthlyRowIds = await evaluate(`[...document.querySelectorAll('[data-payment-installment]')]
  .filter((row) => row.children[2].textContent.trim() === 'شهري').slice(0, 2).map((row) => row.dataset.id)`);
for (const [index, amount] of [[0, '10000'], [1, '5000']]) {
  const rowId = monthlyRowIds[index];
  await setField(`[data-payment-installment][data-id="${rowId}"] [name="installmentSelected"]`, true, 'change');
  if (index === 1) await setField(`[data-payment-installment][data-id="${rowId}"] [name="allocationAmount"]`, amount, 'change');
}
await setField('[data-form="property-receipt"] [name="receivableAccountId"]', reference.receivableAccountId, 'change');
await setField('[data-form="property-receipt"] [name="cashBoxId"]', reference.cashBoxId, 'change');
await setField('[data-form="property-receipt"] [name="reference"]', 'E2E-REC-001');
await setField('[data-form="property-receipt"] [name="notes"]', 'اختبار Electron فعلي');
const receiptTotal = await evaluate(`document.querySelector('[data-form="property-receipt"] [name="receiptTotal"]').value`);
const allocationDebug = await evaluate(`(() => ({
  total: document.querySelector('[data-form="property-receipt"] [name="receiptTotal"]')?.value,
  checked: [...document.querySelectorAll('[name="installmentSelected"]')].map((input) => ({ checked: input.checked, value: input.value })),
  allocations: [...document.querySelectorAll('[name="allocationAmount"]')].map((input) => ({ value: input.value, form: input.form?.dataset.form ?? null })),
  selectedRows: [...document.querySelectorAll('[data-payment-installment]')].filter((row) => row.querySelector('[name="installmentSelected"]')?.checked).map((row) => ({ id: row.dataset.id, remaining: row.dataset.remaining })),
}))()`);
writeFileSync(join(userData, 'ui-allocation-debug.json'), JSON.stringify(allocationDebug, null, 2));
assert.equal(receiptTotal, '15000.00');
await click('[data-form="property-receipt"] button[type="submit"]');
await waitFor('[data-property-receipt]');
const afterReceipt = await evaluate(`(() => ({
  receiptRows: document.querySelectorAll('.property-receipt-history tbody tr').length,
  reference: document.querySelector('.property-receipt-history tbody tr td:nth-child(4)')?.textContent.trim(),
  paid: [...document.querySelectorAll('[data-payment-installment]')].filter((row) => row.children[8].textContent.trim() === 'مسدد').length,
  partial: [...document.querySelectorAll('[data-payment-installment]')].filter((row) => row.children[8].textContent.trim() === 'مسدد جزئيًا').length,
  outstanding: [...document.querySelectorAll('.property-plan-summary strong')][3]?.textContent.trim(),
}))()`);
assert.equal(afterReceipt.receiptRows, 1);
assert.equal(afterReceipt.reference, 'E2E-REC-001');
assert.equal(afterReceipt.paid, 1);
assert.equal(afterReceipt.partial, 1);
await click('[data-project-view="property-contracts"]');
await waitFor('[data-property-contract]');
await click('[data-project-view="property-payments"]');
await waitFor('[data-form="property-receipt"]');
const reopenedPage = await evaluate(`({
  installmentCount: document.querySelectorAll('[data-payment-installment]').length,
  receiptCount: document.querySelectorAll('[data-property-receipt]').length,
  collected: [...document.querySelectorAll('.property-plan-summary strong')][2]?.textContent.trim(),
})`);
assert.equal(reopenedPage.installmentCount, 16);
assert.equal(reopenedPage.receiptCount, 1);
assert.match(reopenedPage.collected, /١٥|15/);

const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
const savedContract = database.prepare("SELECT id, status FROM property_contracts WHERE unit_id = (SELECT id FROM property_units WHERE code = 'E2E-UNIT')").get();
assert.equal(savedContract.status, 'approved');
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM property_installments WHERE contract_id = ?').get(savedContract.id).count), 16);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM property_receipts WHERE contract_id = ?').get(savedContract.id).count), 1);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM property_receipt_allocations').get().count), 2);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 1);
database.close();

const paymentScreenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(join(screenshots, 'property-payments.png'), Buffer.from(paymentScreenshot.data, 'base64'));
console.log(JSON.stringify({
  electronWindow: target.title,
  contract: contractText,
  planStatus,
  unallocated,
  installments: counts,
  receiptTotal,
  receiptResult: afterReceipt,
  reopenedPage,
  screenshots,
}, null, 2));

socket.close();