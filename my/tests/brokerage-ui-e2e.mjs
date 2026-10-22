import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const userData = process.argv[2];
const stage = process.argv[3] ?? 'create';
if (!userData) throw new Error('Pass an isolated Electron user-data directory.');
const port = process.env.ELSAAD_CDP_PORT ?? '9222';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer window is not available on the DevTools endpoint.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
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
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for removal of ' + ${JSON.stringify(selector)})); }, 20000);
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function setField(selector, value) {
  assert.equal(await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.value = ${JSON.stringify(String(value))};
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`), true, `Missing field ${selector}`);
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
if (!(await evaluate(`document.querySelector('#brokerage-subpages')?.hidden`))) {
  await click('[data-action="brokerage-toggle"]');
  assert.equal(await evaluate(`document.querySelector('#brokerage-subpages').hidden`), true);
}
await click('[data-action="brokerage-toggle"]');
assert.equal(await evaluate(`document.querySelector('#brokerage-subpages').hidden`), false);
await click('[data-brokerage-page="broker-data"]');
await waitFor('.brokerage-page');
assert.match(await evaluate(`document.querySelector('.brokerage-page h1').textContent`), /بيانات السمسرة/);

const brokerCode = 'E2E-BROKER-ERP';
const rowSelector = `[data-broker-code="${brokerCode}"]`;
if (stage === 'contract-rate') {
  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  database.prepare(`INSERT OR IGNORE INTO projects (code, name, start_date, end_date, cost_center, status)
    VALUES (?, ?, '2026-01-01', '', 'E2E', 'in-progress')`).run('E2E-BROKER-RATE-PROJECT', 'مشروع نسبة السمسار');
  database.prepare(`INSERT OR IGNORE INTO customers (code, name, status) VALUES (?, ?, 'active')`)
    .run('E2E-BROKER-RATE-CUSTOMER', 'عميل نسبة السمسار');
  const projectId = Number(database.prepare('SELECT id FROM projects WHERE code = ?').get('E2E-BROKER-RATE-PROJECT').id);
  const customerId = Number(database.prepare('SELECT id FROM customers WHERE code = ?').get('E2E-BROKER-RATE-CUSTOMER').id);
  database.prepare(`INSERT OR IGNORE INTO property_units (project_id, code, name, original_price)
    VALUES (?, 'E2E-BROKER-RATE-UNIT', 'وحدة نسبة السمسار', '100000')`).run(projectId);
  const unitId = Number(database.prepare('SELECT id FROM property_units WHERE project_id = ? AND code = ?').get(projectId, 'E2E-BROKER-RATE-UNIT').id);
  database.close();

  const brokerIds = await evaluate(`Promise.all([
    window.elsaad.savePropertyBroker({code:'E2E-RATE-1',name:'سمسار بنسبة أولى',phone:'',commissionRate:'2.5',status:'active'}),
    window.elsaad.savePropertyBroker({code:'E2E-RATE-2',name:'سمسار بنسبة ثانية',phone:'',commissionRate:'4.5',status:'active'})
  ]).then((brokers) => brokers.map((broker) => broker.id))`);
  await click('[data-project-view="property-contracts"]');
  await waitFor('[data-action="property-contract-add"]');
  await click('[data-action="property-contract-add"]');
  await waitFor('[data-form="property-contract"]');
  await setField('[data-form="property-contract"] [name="projectId"]', projectId);
  await setField('[data-form="property-contract"] [name="unitId"]', unitId);
  await setField('[data-form="property-contract"] [name="customerId"]', customerId);
  await setField('[data-form="property-contract"] [name="brokerId"]', brokerIds[0]);
  assert.equal(await evaluate(`document.querySelector('[data-form="property-contract"] [name="brokerRate"]').value`), '2.5');
  await setField('[data-form="property-contract"] [name="brokerId"]', brokerIds[1]);
  assert.equal(await evaluate(`document.querySelector('[data-form="property-contract"] [name="brokerRate"]').value`), '4.5');
  await setField('[data-form="property-contract"] [name="brokerRate"]', '7.25');
  await setField('[data-form="property-contract"] [name="brokerId"]', brokerIds[0]);
  assert.equal(await evaluate(`document.querySelector('[data-form="property-contract"] [name="brokerRate"]').value`), '7.25');
  await click('[data-action="property-modal-close"]');
  await evaluate(`Promise.all(${JSON.stringify(brokerIds)}.map((id) => window.elsaad.deletePropertyBroker(id)))`);
  const cleanupDb = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  cleanupDb.prepare('DELETE FROM property_units WHERE id = ?').run(unitId);
  cleanupDb.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  cleanupDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  cleanupDb.close();
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ stage, defaultRatesApplied: true, manualRatePreserved: true, testRowsCleaned: true }, null, 2));
} else if (stage === 'layout') {
  await setField('[data-form="brokerage-search"] [name="search"]', brokerCode);
  await click('[data-form="brokerage-search"] button[type="submit"]');
  await waitFor(rowSelector);
  const layout = await evaluate(`(() => {
    const scroller = document.querySelector('.brokerage-page .table-scroll');
    const buttons = [...document.querySelectorAll(${JSON.stringify(rowSelector)} + ' .brokerage-actions .button')];
    const bounds = scroller.getBoundingClientRect();
    return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, buttons: buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.textContent.trim(), visible: rect.left >= bounds.left && rect.right <= bounds.right };
    }) };
  })()`);
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `Unexpected horizontal overflow: ${JSON.stringify(layout)}`);
  assert.equal(layout.buttons.length, 3);
  assert.ok(layout.buttons.every((button) => button.visible), `An action button is outside the desktop table: ${JSON.stringify(layout)}`);
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const screenshots = join(userData, 'screenshots');
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(join(screenshots, 'brokerage-layout.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('window.print = () => { window.__brokeragePrintCalled = true; }');
  await click(`${rowSelector} [data-action="brokerage-print"]`);
  assert.equal(await evaluate('window.__brokeragePrintCalled'), true);
  assert.match(await evaluate(`document.querySelector('#brokerage-print-host').innerText`), /بيانات السمسار/);
  assert.equal(await evaluate(`document.querySelector('#brokerage-print-host').querySelector('button')`), null);
  console.log(JSON.stringify({ stage, layout, screenshot: join(screenshots, 'brokerage-layout.png'), printAction: 'window.print dispatched' }, null, 2));
} else if (stage === 'create') {
  await click('[data-action="brokerage-new"]');
  await waitFor('[data-form="brokerage-broker"]');
  await click('[data-action="brokerage-cancel"]');
  await waitForGone('[data-form="brokerage-broker"]');
  assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(rowSelector)}))`), false, 'New must not save automatically.');

  await click('[data-action="brokerage-new"]');
  await setField('[data-form="brokerage-broker"] [name="code"]', brokerCode);
  await setField('[data-form="brokerage-broker"] [name="name"]', 'سمسار اختبار Electron');
  await setField('[data-form="brokerage-broker"] [name="commissionRate"]', '2.5');
  await setField('[data-form="brokerage-broker"] [name="phone"]', '01000000000');
  await click('[data-form="brokerage-broker"] button[type="submit"]');
  await waitFor(rowSelector);
  assert.match(await evaluate(`document.querySelector('.brokerage-notice').textContent`), /تم حفظ بيانات السمسار بنجاح/);
  const originalId = await evaluate(`document.querySelector(${JSON.stringify(rowSelector)}).dataset.brokerId`);

  await setField('[data-form="brokerage-search"] [name="search"]', 'غير موجود');
  await click('[data-form="brokerage-search"] button[type="submit"]');
  await waitFor('.brokerage-page tbody .empty-state');
  await setField('[data-form="brokerage-search"] [name="search"]', brokerCode);
  await click('[data-form="brokerage-search"] button[type="submit"]');
  await waitFor(rowSelector);
  assert.equal(await evaluate(`document.querySelectorAll('.brokerage-page tbody tr[data-broker-id]').length`), 1);

  await click(`${rowSelector} [data-action="brokerage-edit"]`);
  await setField('[data-form="brokerage-broker"] [name="name"]', 'سمسار اختبار بعد التعديل');
  await setField('[data-form="brokerage-broker"] [name="commissionRate"]', '4.5');
  await click('[data-form="brokerage-broker"] button[type="submit"]');
  await waitFor(rowSelector);
  assert.match(await evaluate(`document.querySelector('.brokerage-notice').textContent`), /تم تعديل بيانات السمسار بنجاح/);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(rowSelector)}).dataset.brokerId`), originalId, 'Edit must update the same broker id.');
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(rowSelector)}).innerText`), /سمسار اختبار بعد التعديل/);
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(rowSelector)}).innerText`), /4\.5%/);

  const invalidRate = await evaluate(`window.elsaad.savePropertyBroker({code:'E2E-BROKER-BAD',name:'غير صالح',phone:'',commissionRate:'Infinity',status:'active'}).then(() => 'saved', (error) => error.message)`);
  assert.match(invalidRate, /نسبة العمولة/);
  const duplicateCode = await evaluate(`window.elsaad.savePropertyBroker({code:${JSON.stringify(brokerCode.toLowerCase())},name:'كود مكرر',phone:'',commissionRate:'0',status:'active'}).then(() => 'saved', (error) => error.message)`);
  assert.match(duplicateCode, /كود السمسار مسجل/);

  await evaluate('window.print = () => { window.__brokeragePrintCalled = true; }');
  await click(`${rowSelector} [data-action="brokerage-print"]`);
  assert.equal(await evaluate('window.__brokeragePrintCalled'), true);
  assert.match(await evaluate(`document.querySelector('#brokerage-print-host').innerText`), /سمسار اختبار بعد التعديل/);
  assert.equal(await evaluate(`document.querySelector('#brokerage-print-host').querySelector('button')`), null);
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const screenshots = join(userData, 'screenshots');
  mkdirSync(screenshots, { recursive: true });
  writeFileSync(join(screenshots, 'brokerage-page.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate("window.dispatchEvent(new Event('afterprint'))");
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ stage, brokerId: Number(originalId), saved: true, editedSameRecord: true, invalidRateRejected: true, duplicateRejected: true, printSheet: true, screenshots }, null, 2));
} else if (stage === 'verify-restart') {
  await setField('[data-form="brokerage-search"] [name="search"]', brokerCode);
  await click('[data-form="brokerage-search"] button[type="submit"]');
  await waitFor(rowSelector);
  const brokerRow = await evaluate(`document.querySelector(${JSON.stringify(rowSelector)}).innerText`);
  assert.match(brokerRow, /سمسار اختبار بعد التعديل/);
  assert.match(brokerRow, /4\.5%/);
  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  const persisted = database.prepare('SELECT id, name, commission_rate FROM property_brokers WHERE code = ?').get(brokerCode);
  assert.ok(persisted, 'Broker must survive Electron restart in the isolated profile.');
  assert.equal(persisted.name, 'سمسار اختبار بعد التعديل');
  assert.equal(persisted.commission_rate, '4.5');
  database.close();

  await evaluate('window.confirm = () => true');
  await click(`${rowSelector} [data-action="brokerage-delete"]`);
  await waitForGone(rowSelector);
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ stage, persistedAfterRestart: true, deletedOnlyTestBroker: true }, null, 2));
} else {
  throw new Error(`Unknown stage: ${stage}`);
}

socket.close();
