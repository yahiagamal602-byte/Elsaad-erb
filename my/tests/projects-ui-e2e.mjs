import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass an isolated ELSAAD_TEST_USER_DATA directory.');
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'No Electron renderer target was found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const jsErrors = [];
const consoleErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') jsErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params.entry.text);
  if (message.method === 'Page.javascriptDialogOpening') {
    const id = ++nextId;
    pending.set(id, { resolve: () => undefined, reject: () => undefined });
    socket.send(JSON.stringify({ id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
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
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

async function waitFor(selector) {
  await evaluate(`new Promise((resolve, reject) => {
    if (document.querySelector(${JSON.stringify(selector)})) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector(${JSON.stringify(selector)})) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out: ' + ${JSON.stringify(selector)})); }, 20000);
  })`);
}

async function waitForValue(selector, expected) {
  await evaluate(`new Promise((resolve, reject) => {
    const read = () => document.querySelector(${JSON.stringify(selector)})?.value;
    if (read() === ${JSON.stringify(String(expected))}) return resolve(true);
    const started = Date.now();
    const poll = () => {
      if (read() === ${JSON.stringify(String(expected))}) return resolve(true);
      if (Date.now() - started > 20000) return reject(new Error('Timed out waiting for field value ' + ${JSON.stringify(selector)}));
      requestAnimationFrame(poll);
    };
    poll();
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function field(selector, value, eventName = 'input') {
  assert.equal(await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(${JSON.stringify(value)});
    else node.value = ${JSON.stringify(String(value))};
    node.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }));
    return true;
  })()`), true, `Missing field ${selector}`);
}

async function pageSnapshot(key, selector, expectedText) {
  await waitFor(selector);
  const content = await evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText`);
  if (expectedText) assert.match(content, expectedText, `Unexpected content on ${key}`);
  const directory = join(userData, 'screenshots');
  mkdirSync(directory, { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
  writeFileSync(join(directory, `${key}.png`), Buffer.from(screenshot.data, 'base64'));
  return content;
}

function seedBase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  const account = (code, name, type) => {
    database.prepare('INSERT OR IGNORE INTO accounts (code, name, account_type) VALUES (?, ?, ?)').run(code, name, type);
    return Number(database.prepare('SELECT id FROM accounts WHERE code = ?').get(code).id);
  };
  const assetAccountId = account('E2E-PROJ-ASSET', 'أصول اختبار المشاريع', 'asset');
  const receivableAccountId = account('E2E-PROJ-AR', 'ذمم اختبار المشاريع', 'asset');
  account('E2E-PROJ-EXP', 'مصروف عمولة اختبار المشاريع', 'expense');
  database.prepare(`INSERT OR IGNORE INTO customers (code, name, status) VALUES (?, ?, 'active')`)
    .run('E2E-PROJ-CUSTOMER', 'عميل اختبار المشاريع');
  const customerId = Number(database.prepare('SELECT id FROM customers WHERE code = ?').get('E2E-PROJ-CUSTOMER').id);
  database.prepare(`INSERT OR IGNORE INTO treasury_cash_boxes
    (code, name, account_id, currency, opening_balance, opening_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('E2E-PROJ-CASH', 'خزينة اختبار المشاريع', assetAccountId, 'EGP', '1000000', '2020-01-01', 'active');
  const cashBoxId = Number(database.prepare('SELECT id FROM treasury_cash_boxes WHERE code = ?').get('E2E-PROJ-CASH').id);
  database.prepare(`INSERT OR IGNORE INTO inventory_units (code, name_ar, abbreviation, status) VALUES (?, ?, ?, 'active')`)
    .run('E2E-PROJ-UNIT', 'وحدة اختبار', 'وحدة');
  const inventoryUnitId = Number(database.prepare('SELECT id FROM inventory_units WHERE code = ?').get('E2E-PROJ-UNIT').id);
  database.prepare(`INSERT OR IGNORE INTO warehouses (code, name, account_id, status) VALUES (?, ?, ?, 'active')`)
    .run('E2E-PROJ-WH', 'مخزن اختبار المشاريع', assetAccountId);
  const warehouseId = Number(database.prepare('SELECT id FROM warehouses WHERE code = ?').get('E2E-PROJ-WH').id);
  database.prepare(`INSERT OR IGNORE INTO inventory_items
    (code, name_ar, name_en, barcode, base_unit_id, purchase_price, sales_price, tax_rate, status, sellable, purchasable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1)`)
    .run('E2E-PROJ-ITEM', 'أسمنت اختبار', 'Test Cement', '', inventoryUnitId, '20', '25', '');
  const inventoryItemId = Number(database.prepare('SELECT id FROM inventory_items WHERE code = ?').get('E2E-PROJ-ITEM').id);
  database.prepare(`INSERT OR IGNORE INTO inventory_opening_balances (item_id, warehouse_id, quantity, unit_cost)
    VALUES (?, ?, ?, ?)`).run(inventoryItemId, warehouseId, '100', '20');
  database.close();
  return { customerId, cashBoxId, receivableAccountId, warehouseId, inventoryItemId, inventoryUnitId };
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await cdp('Log.enable');
await cdp('Page.enable');
const refs = seedBase(join(userData, 'elsaad-erp.sqlite'));
await waitFor('#login-form');
await field('#login-form [name="username"]', 'admin');
await field('#login-form [name="password"]', 'E2e#SecurePassword2026');
await click('#login-form button[type="submit"]');
await waitFor('.app-shell');
const result = {};
console.log('Electron renderer and login passed.');

async function visitProjectView(selector, key, contentSelector, expectedText) {
  await click(selector);
  return pageSnapshot(key, contentSelector, expectedText);
}

await visitProjectView('[data-project-view="project-list"]', 'projects', '.project-page', /المشاريع/);
await click('[data-action="project-add"]');
await waitFor('[data-form="project"]');
await field('[data-form="project"] [name="code"]', 'E2E-PROJECT');
await field('[data-form="project"] [name="name"]', 'مشروع تكامل المشاريع');
await field('[data-form="project"] [name="startDate"]', '2026-01-01');
await field('[data-form="project"] [name="endDate"]', '2026-12-31');
await field('[data-form="project"] [name="costCenter"]', 'E2E-CC');
await field('[data-form="project"] [name="status"]', 'in-progress', 'change');
await click('[data-form="project"] button[type="submit"]');
await waitFor('[data-project-row]');
assert.match(await evaluate(`document.querySelector('[data-project-row]').innerText`), /مشروع تكامل المشاريع/);
await field('#project-search', 'E2E-PROJECT');
assert.equal(await evaluate(`document.querySelectorAll('[data-project-row]:not([hidden])').length`), 1);
await field('#project-search', 'missing-project');
assert.equal(await evaluate(`document.querySelectorAll('[data-project-row]:not([hidden])').length`), 0);
await field('#project-search', '');
await field('#project-status-filter', 'completed', 'change');
assert.equal(await evaluate(`document.querySelectorAll('[data-project-row]:not([hidden])').length`), 0);
await field('#project-status-filter', '', 'change');
assert.equal(await evaluate(`document.querySelectorAll('[data-project-row]:not([hidden])').length`), 1);
const projectId = Number(await evaluate(`document.querySelector('[data-action="project-edit"]').dataset.id`));
await click(`[data-action="project-edit"][data-id="${projectId}"]`);
await waitFor('[data-form="project"]');
await field('[data-form="project"] [name="name"]', 'مشروع تكامل المشاريع معدل');
await click('[data-form="project"] button[type="submit"]');
await waitFor('[data-project-row]');
assert.match(await evaluate(`document.querySelector('[data-project-row]').innerText`), /معدل/);
result.projects = 'create, search, edit and reopen passed';
console.log('Projects create/search/edit passed.');

await click('[data-action="project-add"]');
await waitFor('[data-form="project"]');
await field('[data-form="project"] [name="code"]', 'E2E-DELETE');
await field('[data-form="project"] [name="name"]', 'مشروع للحذف');
await field('[data-form="project"] [name="startDate"]', '2026-01-01');
await click('[data-form="project"] button[type="submit"]');
await waitFor('[data-project-row]');
const deleteId = Number(await evaluate(`document.querySelector('[data-project-row][data-search*="e2e-delete"] [data-action="project-delete"]').dataset.id`));
await click(`[data-action="project-delete"][data-id="${deleteId}"]`);
await waitFor('[data-project-row]');
assert.equal(await evaluate(`!!document.querySelector('[data-project-row][data-search*="e2e-delete"]')`), false);

await visitProjectView('[data-portfolio-view="projects"]', 'project-dashboard', '.portfolio-dashboard', /لوحة تحليلية|الإيرادات المثبتة/);
assert.match(await evaluate(`document.querySelector('.portfolio-dashboard').innerText`), /مشروع تكامل المشاريع معدل/);
await field('[data-form="portfolio-filter"] [name="projectId"]', projectId, 'change');
await click('[data-form="portfolio-filter"] button[type="submit"]');
await waitFor('.portfolio-dashboard');
assert.match(await evaluate(`document.querySelector('.portfolio-dashboard').innerText`), /مشروع تكامل المشاريع معدل/);
await click('[data-form="portfolio-filter"] [data-action="portfolio-reset"]');
await waitFor('.portfolio-dashboard');
await visitProjectView('[data-portfolio-view="properties"]', 'property-dashboard', '.portfolio-dashboard', /لوحة تحليلية|إجمالي مبيعات الوحدات/);
assert.match(await evaluate(`document.querySelector('.portfolio-dashboard').innerText`), /مشروع تكامل المشاريع معدل/);
await field('[data-form="portfolio-filter"] [name="projectId"]', projectId, 'change');
await click('[data-form="portfolio-filter"] button[type="submit"]');
await waitFor('.portfolio-dashboard');
assert.match(await evaluate(`document.querySelector('.portfolio-dashboard').innerText`), /مشروع تكامل المشاريع معدل/);
await click('[data-form="portfolio-filter"] [data-action="portfolio-reset"]');
await waitFor('.portfolio-dashboard');
result.dashboards = 'project and property dashboards opened and showed the saved project';
console.log('Both dashboards passed.');

await visitProjectView('[data-project-view="work-items"]', 'work-items', '#work-item-form', /./);
await field('#work-item-form [name="projectId"]', projectId, 'change');
await field('#work-item-form [name="code"]', 'E2E-WORK');
await field('#work-item-form [name="name"]', 'بند اختبار الخرسانة');
await field('#work-item-form [name="description"]', 'وصف أول');
await click('#work-item-form button[type="submit"]');
await waitFor('[data-tree-node]');
assert.match(await evaluate(`document.querySelector('#work-item-tree').innerText`), /بند اختبار الخرسانة/);
await field('#work-item-search', 'E2E-WORK');
assert.equal(await evaluate(`document.querySelectorAll('[data-work-item-row]:not([hidden])').length`), 1);
await field('#work-item-search', 'no-match');
assert.equal(await evaluate(`document.querySelectorAll('[data-work-item-row]:not([hidden])').length`), 0);
await field('#work-item-search', '');
await click('#work-item-tree [data-action="work-item-edit"]');
await waitFor('#work-item-form [name="id"]');
await field('#work-item-form [name="description"]', 'وصف معدل');
await click('#work-item-form button[type="submit"]');
await waitFor('#work-item-tree');
assert.match(await evaluate(`document.querySelector('#work-item-form [name="description"]').value`), /وصف معدل/);
const workItemId = Number(await evaluate(`document.querySelector('#work-item-form [name="id"]').value`));
await click(`[data-action="work-item-toggle"][data-id="${workItemId}"]`);
await waitForValue('#work-item-form [name="status"]', 'inactive');
assert.equal(await evaluate(`document.querySelector('#work-item-form [name="status"]').value`), 'inactive');
await click(`[data-action="work-item-toggle"][data-id="${workItemId}"]`);
await waitForValue('#work-item-form [name="status"]', 'active');
assert.equal(await evaluate(`document.querySelector('#work-item-form [name="status"]').value`), 'active');
result.workItems = 'create, search, edit and activate/deactivate passed';
console.log('Work-items create/search/edit/status passed.');

await visitProjectView('[data-project-view="project-material-issues"]', 'project-materials', '.project-page', /صرف مواد المشاريع/);
await click('[data-action="project-issue-add"]');
await waitFor('[data-form="project-issue"]');
await field('[data-form="project-issue"] [name="projectId"]', projectId, 'change');
await field('[data-form="project-issue"] [name="warehouseId"]', refs.warehouseId, 'change');
await field('[data-project-issue-line] [name="itemId"]', refs.inventoryItemId, 'change');
await field('[data-project-issue-line] [name="workItemId"]', workItemId, 'change');
await field('[data-project-issue-line] [name="quantity"]', '4');
assert.match(await evaluate(`document.querySelector('#project-issue-total').textContent`), /80|٨٠/);
await field('[data-form="project-issue"] [name="date"]', '2026-10-19');
await field('[data-form="project-issue"] [name="reason"]', 'صرف لاختبار المشروع');
await click('[data-form="project-issue"] button[type="submit"]');
await waitFor('#project-issue-modal [data-action="project-issue-approve"]');
const issueId = Number(await evaluate(`document.querySelector('#project-issue-modal [data-action="project-issue-approve"]').dataset.id`));
const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(database.prepare('SELECT status FROM inventory_issues WHERE id = ?').get(issueId).status, 'draft');
database.close();
await click(`#project-issue-modal [data-action="project-issue-approve"][data-id="${issueId}"]`);
await waitFor('[data-project-issue-row]');
const issueDatabase = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
const issueStatus = issueDatabase.prepare('SELECT status FROM inventory_issues WHERE id = ?').get(issueId).status;
const stockQuantity = String(issueDatabase.prepare(`SELECT quantity_delta FROM inventory_stock_movements
  WHERE document_type = 'issue' AND document_id = ? AND movement_type = 'issue'`).get(issueId).quantity_delta);
issueDatabase.close();
assert.equal(issueStatus, 'approved');
assert.equal(stockQuantity, '-4');
result.projectMaterials = 'draft saved, approved, and stock movement of -4 persisted';
console.log('Project-material issue draft, approval and stock movement passed.');
await field('#project-issue-search', 'E2E-PROJECT');
assert.equal(await evaluate(`document.querySelectorAll('[data-project-issue-row]:not([hidden])').length`), 1);
await field('#project-issue-search', 'not-present');
assert.equal(await evaluate(`document.querySelectorAll('[data-project-issue-row]:not([hidden])').length`), 0);
await field('#project-issue-search', '');

await visitProjectView('[data-project-view="property-units"]', 'property-units', '.property-sales-page', /وحدات المشروع/);
await click('[data-action="property-unit-add"]');
await waitFor('[data-form="property-unit"]');
await field('[data-form="property-unit"] [name="projectId"]', projectId, 'change');
await field('[data-form="property-unit"] [name="code"]', 'E2E-UNIT');
await field('[data-form="property-unit"] [name="name"]', 'وحدة اختبار المشاريع');
await field('[data-form="property-unit"] [name="floor"]', '3');
await field('[data-form="property-unit"] [name="area"]', '100');
await field('[data-form="property-unit"] [name="originalPrice"]', '600000');
await click('[data-form="property-unit"] button[type="submit"]');
await waitFor('[data-property-unit]');
assert.match(await evaluate(`document.querySelector('[data-property-unit]').innerText`), /600,000|٦٠٠/);
result.propertyUnits = 'unit create and rendered price/area data passed';
console.log('Property unit create passed.');

await visitProjectView('[data-project-view="property-contracts"]', 'unit-contracts', '.property-sales-page', /عقود بيع الوحدات/);
await click('[data-action="property-contract-add"]');
await waitFor('[data-form="property-contract"]');
await field('[data-form="property-contract"] [name="projectId"]', projectId, 'change');
const unitId = Number(await evaluate(`document.querySelector('[data-form="property-contract"] [name="unitId"] option:not([value=""])').value`));
await field('[data-form="property-contract"] [name="unitId"]', unitId, 'change');
await field('[data-form="property-contract"] [name="customerId"]', refs.customerId, 'change');
await field('[data-form="property-contract"] [name="contractDate"]', '2026-10-19');
await field('[data-form="property-contract"] [name="downPaymentDueDate"]', '2026-10-20');
await field('[data-form="property-contract"] [name="originalPrice"]', '600000');
await field('[data-form="property-contract"] [name="downPayment"]', '100000');
for (const [frequency, date] of [
  ['monthly', '2026-11-19'], ['quarterly', '2027-01-19'], ['semiannual', '2027-04-19'], ['annual', '2027-10-19'],
]) {
  await field(`[data-form="property-contract"] [name="${frequency}Amount"]`, '100000');
  await field(`[data-form="property-contract"] [name="${frequency}Count"]`, frequency === 'monthly' ? 10 : 1);
  await field(`[data-form="property-contract"] [name="${frequency}FirstDate"]`, date);
}
await click('[data-action="property-free-add"]');
await click('[data-action="property-free-add"]');
for (const [index, dueDate] of [[0, '2026-12-19'], [1, '2027-02-19']]) {
  await field(`[data-property-free-payment]:nth-child(${index + 1}) [name="freeAmount"]`, '50000');
  await field(`[data-property-free-payment]:nth-child(${index + 1}) [name="freeDueDate"]`, dueDate);
  await field(`[data-property-free-payment]:nth-child(${index + 1}) [name="freeDescription"]`, `دفعة حرة ${index + 1}`);
}
assert.equal(await evaluate(`document.querySelector('[data-total-frequency="status"]').textContent.trim()`), 'مكتملة');
assert.match(await evaluate(`document.querySelector('[data-total-frequency="undistributed"]').textContent`), /0/);
await pageSnapshot('unit-contract-plan', '[data-form="property-contract"]', /أقساط شهرية|أقساط ربع سنوي/);
await click('[data-form="property-contract"] button[name="mode"][value="approve"]');
await waitFor('[data-property-contract]');
const contractId = Number((await evaluate(`document.querySelector('[data-property-contract] button[data-action="property-contract-edit"]').dataset.id`)));
const contractNumber = await evaluate(`document.querySelector('[data-property-contract]').innerText`);
const contractDatabase = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(contractDatabase.prepare('SELECT status FROM property_contracts WHERE id = ?').get(contractId).status, 'approved');
assert.equal(Number(contractDatabase.prepare('SELECT COUNT(*) AS count FROM property_installments WHERE contract_id = ?').get(contractId).count), 16);
contractDatabase.close();
result.unitSales = 'approved mixed plan saved with 16 actual installments';
console.log('Unit contract mixed schedule approval passed.');

await visitProjectView('[data-project-view="property-payments"]', 'unit-payments', '.property-sales-page', /سداد مبيعات الوحدات/);
await field('[data-form="property-payment-search"] [name="search"]', 'SU-');
await click('[data-form="property-payment-search"] button[type="submit"]');
await waitFor('[data-action="property-payment-select"]');
assert.match(await evaluate(`document.querySelector('[data-action="property-payment-select"]').innerText`), /مشروع تكامل المشاريع معدل|عميل اختبار المشاريع/);
await click(`[data-action="property-payment-select"][data-id="${contractId}"]`);
await waitFor('[data-form="property-receipt"]');
const installmentCounts = await evaluate(`(() => {
 const rows = [...document.querySelectorAll('[data-payment-installment]')];
 const count = (label) => rows.filter((row) => row.children[2].textContent.trim() === label).length;
 return { total: rows.length, monthly: count('شهري'), quarterly: count('ربع سنوي'), semiannual: count('نصف سنوي'), annual: count('سنوي'), free: count('دفعة حرة'), down: count('مقدم') };
})()`);
assert.deepEqual(installmentCounts, { total: 16, monthly: 10, quarterly: 1, semiannual: 1, annual: 1, free: 2, down: 1 });
const monthlyIds = await evaluate(`[...document.querySelectorAll('[data-payment-installment]')]
 .filter((row) => row.children[2].textContent.trim() === 'شهري').slice(0, 2).map((row) => row.dataset.id)`);
for (const [index, amount] of [[0, '10000'], [1, '5000']]) {
  const id = monthlyIds[index];
  await field(`[data-payment-installment][data-id="${id}"] [name="installmentSelected"]`, true, 'change');
  if (index === 1) await field(`[data-payment-installment][data-id="${id}"] [name="allocationAmount"]`, amount, 'change');
}
await field('[data-form="property-receipt"] [name="receivableAccountId"]', await evaluate(`document.querySelector('[data-form="property-receipt"] [name="receivableAccountId"] option:not([value=""])').value`), 'change');
await field('[data-form="property-receipt"] [name="cashBoxId"]', refs.cashBoxId, 'change');
await field('[data-form="property-receipt"] [name="reference"]', 'E2E-PROJ-REC');
await field('[data-form="property-receipt"] [name="notes"]', 'تحصيل واجهة اختبار');
const receiptTotal = await evaluate(`document.querySelector('[data-form="property-receipt"] [name="receiptTotal"]').value`);
assert.equal(receiptTotal, '15000.00');
await pageSnapshot('unit-payments-before-receipt', '.property-payment-contract', /الاستحقاقات|المتبقي/);
await click('[data-form="property-receipt"] button[type="submit"]');
await waitFor('[data-property-receipt]');
const receiptText = await evaluate(`document.querySelector('.property-receipt-history').innerText`);
assert.match(receiptText, /E2E-PROJ-REC/);
assert.match(receiptText, /15,?000|١٥(?:٬)?٠٠٠/);
const paymentDatabase = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(Number(paymentDatabase.prepare('SELECT COUNT(*) AS count FROM property_receipts WHERE contract_id = ?').get(contractId).count), 1);
assert.equal(Number(paymentDatabase.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 1);
assert.equal(Number(paymentDatabase.prepare('SELECT COUNT(*) AS count FROM property_receipt_allocations').get().count), 2);
assert.equal(String(paymentDatabase.prepare('SELECT SUM(quantity_delta) AS quantity FROM inventory_stock_movements WHERE document_type = ?').get('issue').quantity), '-4');
paymentDatabase.close();
await pageSnapshot('unit-payments-after-receipt', '.property-payment-contract', /E2E-PROJ-REC/);
result.unitPayments = 'all 16 installments shown; 10,000 full + 5,000 partial receipt persisted once';
console.log('Unit payments full/partial collection passed.');

await click('[data-project-view="property-contracts"]');
await waitFor('[data-property-contract]');
assert.match(await evaluate(`document.querySelector('[data-property-contract]').innerText`), /SU-|عميل اختبار المشاريع/);
await pageSnapshot('unit-contracts-reopened', '.property-sales-page', /عقود بيع الوحدات/);
await click('[data-project-view="property-payments"]');
await waitFor('[data-action="property-payment-select"]');
await click(`[data-action="property-payment-select"][data-id="${contractId}"]`);
await waitFor('[data-property-receipt]');
assert.equal(await evaluate(`document.querySelectorAll('[data-property-receipt]').length`), 1);
assert.equal(await evaluate(`document.querySelectorAll('[data-payment-installment]').length`), 16);
result.reopen = 'contract, installments, receipt history and balances survived page navigation';

assert.deepEqual(jsErrors, [], 'JavaScript exceptions occurred in the Electron renderer.');
assert.deepEqual(consoleErrors, [], 'Console errors occurred in the Electron renderer.');
console.log(JSON.stringify({
  electronWindow: target.title,
  pages: result,
  projectId,
  workItemId,
  issueId,
  contractId,
  contractNumber: contractNumber.split('\n')[0],
  installmentCounts,
  receiptTotal,
  screenshots: join(userData, 'screenshots'),
  jsErrors,
  consoleErrors,
}, null, 2));
socket.close();

function seedInventoryForProject(databasePath, projectId) {
  const database = new DatabaseSync(databasePath);
  const accountId = Number(database.prepare('SELECT id FROM accounts WHERE code = ?').get('E2E-PROJ-ASSET').id);
  const unitId = refs.inventoryUnitId;
  const warehouseId = refs.warehouseId;
  const itemId = refs.inventoryItemId;
  database.prepare('UPDATE warehouses SET account_id = ? WHERE id = ?').run(accountId, warehouseId);
  database.prepare('UPDATE inventory_items SET base_unit_id = ? WHERE id = ?').run(unitId, itemId);
  database.close();
  return { projectId };
}