import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass an isolated Electron user-data directory.');
const port = process.env.ELSAAD_CDP_PORT ?? '9222';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer window was not found.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const runtimeErrors = [];
const consoleErrors = [];
socket.addEventListener('close', () => console.log('CDP_SOCKET_CLOSED'));
socket.addEventListener('error', (event) => console.log('CDP_SOCKET_ERROR', event.message ?? ''));
process.on('unhandledRejection', (error) => { console.error('UNHANDLED_REJECTION', error); process.exitCode = 1; process.exit(1); });
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  }
  if (message.id && pending.has(message.id)) {
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message));
    else handlers.resolve(message.result);
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
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(selector) {
  await evaluate(`new Promise((resolve, reject) => {
    if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector(${JSON.stringify(selector)})) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for ' + ${JSON.stringify(selector)})); }, 20000);
  })`);
}

async function waitForGone(selector) {
  await evaluate(`new Promise((resolve, reject) => {
    if (!document.querySelector(${JSON.stringify(selector)})) return resolve(true);
    const observer = new MutationObserver(() => {
      if (!document.querySelector(${JSON.stringify(selector)})) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for ' + ${JSON.stringify(selector)} + ' to close')); }, 20000);
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const item = document.querySelector(${JSON.stringify(selector)}); if (!item) return false; item.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function setField(selector, value) {
  assert.equal(await evaluate(`(() => {
    const item = document.querySelector(${JSON.stringify(selector)});
    if (!item) return false;
    item.value = ${JSON.stringify(String(value))};
    item.dispatchEvent(new Event('input', { bubbles: true }));
    item.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`), true, `Missing field ${selector}`);
}

async function screenshot(name) {
  const image = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const directory = join(userData, 'screenshots');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.png`), Buffer.from(image.data, 'base64'));
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
if (await evaluate(`Boolean(document.querySelector('#login-form'))`)) {
  await setField('#login-form [name="username"]', 'admin');
  await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
  await click('#login-form button[type="submit"]');
}
await waitFor('.app-shell');
await evaluate('window.confirm = () => true');
console.log('Electron session ready');

const setup = await evaluate(`(async () => {
  const accounts = await window.elsaad.listAccounts();
  const ensureAccount = async (code, name, type) => {
    const found = accounts.find((item) => item.code === code);
    if (found) return found.id;
    const created = await window.elsaad.saveAccount({ code, name, nameEn: '', type, parentId: null, postable: true, notes: '' });
    return created.id;
  };
  const cashAccount = await ensureAccount('E2E-1100', 'صندوق اختبار', 'asset');
  const customerAccount = await ensureAccount('E2E-1200', 'عملاء اختبار', 'asset');
  const supplierAccount = await ensureAccount('E2E-2100', 'موردون اختبار', 'liability');
  const expenseAccount = await ensureAccount('E2E-5000', 'مصروفات اختبار', 'expense');
  const payableAccount = await ensureAccount('E2E-2200', 'دائنون اختبار', 'liability');
  const boxes = await window.elsaad.listCashBoxes();
  let cashBox = boxes.find((item) => item.code === 'E2E-CB');
  if (!cashBox) {
    cashBox = await window.elsaad.saveCashBox({ code: 'E2E-CB', name: 'خزينة اختبار', accountId: cashAccount, currency: 'EGP', openingBalance: '0', openingDate: '2026-01-01', status: 'active' });
  }
  const customers = await window.elsaad.listCustomers();
  let customer = customers.find((item) => item.code === 'E2E-CUST');
  if (!customer) {
    customer = await window.elsaad.saveCustomer({ code: 'E2E-CUST', name: 'عميل اختبار', tradeName: '', phone: '', email: '', groupId: null, accountId: customerAccount, city: '', country: '', address: '', taxNumber: '', notes: '', status: 'active' });
  }
  const suppliers = await window.elsaad.listSuppliers();
  let supplier = suppliers.find((item) => item.code === 'E2E-SUPP');
  if (!supplier) {
    supplier = await window.elsaad.saveSupplier({ code: 'E2E-SUPP', name: 'مورد اختبار', tradeName: '', phone: '', email: '', address: '', city: '', country: '', taxNumber: '', commercialRegister: '', groupId: null, accountId: supplierAccount, notes: '', status: 'active' });
  }
  return { cashBoxId: cashBox.id, customerId: customer.id, supplierId: supplier.id, expenseAccount, payableAccount, customerAccount, supplierAccount, cashAccount };
})()`);
console.log('Prerequisites ready', JSON.stringify(setup));

// === Customer vouchers page ===
await click('[data-page="customer-vouchers"]');
await waitFor('[data-action="financial-voucher-new"]');
await screenshot('financial-customer-page');
assert.equal(await evaluate(`document.querySelectorAll('tbody tr').length >= 1`), true, 'Customer voucher table did not render.');
await click('[data-action="financial-voucher-new"]');
await waitFor('[data-form="financial-voucher"]');
await screenshot('financial-customer-editor');
await setField('[data-form="financial-voucher"] [name="date"]', '2026-10-21');
await setField('[data-form="financial-voucher"] [name="partyId"]', setup.customerId);
await setField('[data-form="financial-voucher"] [name="amount"]', '150.50');
await setField('[data-form="financial-voucher"] [name="cashBoxId"]', setup.cashBoxId);
await setField('[data-form="financial-voucher"] [name="reference"]', 'E2E-CR-REF');
await click('[data-form="financial-voucher"] button[type="submit"]');
await waitForGone('#financial-voucher-modal');
await waitFor('[data-search*="e2e-cr-ref"]');
assert.match(await evaluate(`document.querySelector('[data-search*="e2e-cr-ref"]').innerText`), /مسودة/);
await screenshot('financial-customer-saved');
let vouchers = await evaluate(`window.elsaad.listFinancialVouchers('customer', 'E2E-CR-REF')`);
assert.equal(vouchers.length, 1);
assert.equal(vouchers[0].status, 'draft');
assert.equal(vouchers[0].amount, '150.5');
await click('[data-action="financial-voucher-approve"]');
await waitFor('[data-search*="e2e-cr-ref"]');
assert.match(await evaluate(`document.querySelector('[data-search*="e2e-cr-ref"]').innerText`), /مرحّل/);
vouchers = await evaluate(`window.elsaad.listFinancialVouchers('customer', 'E2E-CR-REF')`);
assert.equal(vouchers[0].status, 'posted');
assert.ok(vouchers[0].journalEntryId);
const journalBefore = await evaluate(`window.elsaad.getJournalEntry(${vouchers[0].journalEntryId}).then((entry) => entry.id)`);
await evaluate(`window.elsaad.approveFinancialVoucher(${vouchers[0].id}, 'customer')`);
const journalAfter = await evaluate(`window.elsaad.listFinancialVouchers('customer', 'E2E-CR-REF').then((items) => items[0].journalEntryId)`);
assert.equal(journalAfter, journalBefore);
await screenshot('financial-customer-posted');

// === Supplier vouchers page ===
await click('[data-page="supplier-vouchers"]');
await waitFor('[data-action="financial-voucher-new"]');
await screenshot('financial-supplier-page');
await click('[data-action="financial-voucher-new"]');
await waitFor('[data-form="financial-voucher"]');
await setField('[data-form="financial-voucher"] [name="date"]', '2026-10-22');
await setField('[data-form="financial-voucher"] [name="partyId"]', setup.supplierId);
await setField('[data-form="financial-voucher"] [name="amount"]', '75');
await setField('[data-form="financial-voucher"] [name="cashBoxId"]', setup.cashBoxId);
await setField('[data-form="financial-voucher"] [name="reference"]', 'E2E-SP-REF');
await click('[data-form="financial-voucher"] button[type="submit"]');
await waitForGone('#financial-voucher-modal');
await waitFor('[data-search*="e2e-sp-ref"]');
await click('[data-action="financial-voucher-approve"]');
await waitFor('[data-search*="e2e-sp-ref"]');
const supplierVouchers = await evaluate(`window.elsaad.listFinancialVouchers('supplier', 'E2E-SP-REF')`);
assert.equal(supplierVouchers.length, 1);
assert.equal(supplierVouchers[0].status, 'posted');
assert.ok(supplierVouchers[0].journalEntryId);
await screenshot('financial-supplier-posted');

// === Expenses page ===
await click('[data-page="expenses"]');
await waitFor('[data-action="expense-new"]');
await screenshot('financial-expenses-page');
await click('[data-action="expense-new"]');
await waitFor('[data-form="expense"]');
await setField('[data-form="expense"] [name="date"]', '2026-10-21');
await setField('[data-form="expense"] [name="operationType"]', 'صيانة');
await setField('[data-form="expense"] [name="description"]', 'بند اختبار E2E');
await setField('[data-form="expense"] [name="totalAmount"]', '100');
await setField('[data-form="expense"] [name="paidAmount"]', '40');
await setField('[data-form="expense"] [name="cashBoxId"]', setup.cashBoxId);
await setField('[data-form="expense"] [name="payableAccountId"]', setup.payableAccount);
await setField('[data-expense-allocation] [name="expenseAccountId"]', setup.expenseAccount);
await setField('[data-expense-allocation] [name="amount"]', '100');
assert.equal(await evaluate(`document.querySelector('[data-expense-remaining]').value`), '60');
assert.equal(await evaluate(`document.querySelector('[data-expense-allocated]').textContent`), '100');
await screenshot('financial-expense-editor');
await click('[data-form="expense"] button[type="submit"]');
await waitForGone('#expense-modal');
await waitFor('[data-search*="بند اختبار e2e"]');
const expenseRow = await evaluate(`document.querySelector('[data-search*="بند اختبار e2e"]').innerText`);
assert.match(expenseRow, /مسدد جزئيًا/);
assert.match(expenseRow, /60/);
let expenses = await evaluate(`window.elsaad.listExpenses('بند اختبار E2E')`);
assert.equal(expenses.length, 1);
assert.deepEqual([expenses[0].total, expenses[0].paidAmount, expenses[0].remaining, expenses[0].settlementStatus], ['100', '40', '60', 'partial']);
await click(`[data-action="expense-approve"][data-id="${expenses[0].id}"]`);
await waitFor('[data-search*="بند اختبار e2e"]');
expenses = await evaluate(`window.elsaad.listExpenses('بند اختبار E2E')`);
assert.equal(expenses[0].status, 'posted');
assert.ok(expenses[0].journalEntryId);
const expenseJournal = expenses[0].journalEntryId;
await evaluate(`window.elsaad.approveExpense(${expenses[0].id}).then((item) => item.journalEntryId)`);
assert.equal(await evaluate(`window.elsaad.listExpenses('بند اختبار E2E').then((items) => items[0].journalEntryId)`), expenseJournal);
const expenseEntry = await evaluate(`window.elsaad.getJournalEntry(${expenseJournal})`);
assert.equal(expenseEntry.lines.length, 3);
assert.equal(expenseEntry.totalDebit, '100');
assert.equal(expenseEntry.totalCredit, '100');
await screenshot('financial-expense-posted');

const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM financial_vouchers').get().count), 2);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM expenses').get().count), 1);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 3);
database.close();
assert.deepEqual(runtimeErrors, []);
assert.deepEqual(consoleErrors, []);
console.log(JSON.stringify({
  electronWindow: target.title,
  pages: ['customer-vouchers', 'supplier-vouchers', 'expenses'],
  customerVoucher: { number: vouchers[0].number, status: 'posted' },
  supplierVoucher: { number: supplierVouchers[0].number, status: 'posted' },
  expense: { number: expenses[0].number, total: '100', paid: '40', remaining: '60' },
  noDuplicatePosting: true,
  screenshots: join(userData, 'screenshots'),
}, null, 2));
socket.close();
