import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const userData = process.argv[2];
if (!userData) throw new Error('Pass the isolated Electron user-data directory as the first argument.');
const targets = await (await fetch('http://127.0.0.1:9360/json/list')).json();
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

async function click(selector) {
  assert.equal(await evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!target) return false; target.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function waitForHeading(heading) {
  await evaluate(`new Promise((resolve, reject) => {
    const read = () => document.querySelector('.breadcrumb strong')?.textContent?.trim() === ${JSON.stringify(heading)};
    if (read()) return resolve(true);
    const observer = new MutationObserver(() => { if (read()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for page ' + ${JSON.stringify(heading)})); }, 20000);
  })`);
}

async function assertSidebarPage(selector, heading, groupSelector) {
  await click(selector);
  await waitForHeading(heading);
  const state = await evaluate(`(() => ({
    active: document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-current'),
    groupHidden: document.querySelector(${JSON.stringify(groupSelector)})?.hidden ?? true,
  }))()`);
  assert.equal(state.active, 'page', `${selector} should be marked as the current page`);
  assert.equal(state.groupHidden, false, `${groupSelector} should remain expanded while its page is open`);
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await evaluate(`window.alert = () => {};`);
await evaluate(`new Promise((resolve, reject) => {
  if (document.querySelector('#login-form')) return resolve(true);
  const observer = new MutationObserver(() => { if (document.querySelector('#login-form')) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Login form did not load')); }, 20000);
})`);
await evaluate(`(() => { document.querySelector('#login-form [name="username"]').value = 'admin'; document.querySelector('#login-form [name="password"]').value = 'E2e#SecurePassword2026'; document.querySelector('#login-form button[type="submit"]').click(); })()`);
await waitForHeading('لوحة المؤشرات الجديدة');

assert.deepEqual(await evaluate(`[
  '.sidebar [data-page="customer-vouchers"]', '.sidebar [data-page="supplier-vouchers"]',
  '.sidebar [data-page="expenses"]', '.sidebar [data-page="treasury"]'
].map((selector) => document.querySelectorAll(selector).length)`), [1, 1, 1, 0]);
assert.equal(await evaluate(`document.querySelectorAll('#contractors-subpages [data-contractor-view]').length`), 4);

await click('[data-action="contractors-toggle"]');
assert.equal(await evaluate(`document.querySelector('#contractors-subpages').hidden`), true);
await click('[data-action="contractors-toggle"]');
await assertSidebarPage('[data-page="customer-vouchers"]', 'سندات العملاء', '#contractors-subpages');
await assertSidebarPage('[data-page="supplier-vouchers"]', 'سندات الموردين', '#contractors-subpages');
await assertSidebarPage('[data-page="expenses"]', 'إدارة المصروفات', '#contractors-subpages');
await assertSidebarPage('[data-contractor-view="contractor-list"]', 'المقاولون', '#contractors-subpages');

await click('[data-action="treasury-toggle"]');
assert.equal(await evaluate(`document.querySelector('#treasury-subpages').hidden`), true);
await click('[data-action="treasury-toggle"]');
await assertSidebarPage('[data-treasury-view="cash-boxes"]', 'الخزائن والبنوك', '#treasury-subpages');
assert.equal(await evaluate(`document.querySelector('.treasury-tab--active')?.textContent.trim()`), 'الخزائن');
await assertSidebarPage('[data-treasury-view="banks"]', 'الخزائن والبنوك', '#treasury-subpages');
assert.equal(await evaluate(`document.querySelector('.treasury-tab--active')?.textContent.trim()`), 'البنوك');
assert.match(await evaluate(`document.querySelector('.treasury-table').innerText`), /لا توجد بنوك مسجلة/);
assert.equal(await evaluate(`document.querySelector('#bank-search') instanceof HTMLInputElement`), true);

const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 0);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM treasury_cash_boxes').get().count), 0);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM treasury_bank_accounts').get().count), 0);
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
database.close();
assert.deepEqual(consoleErrors, []);
socket.close();
console.log('Navigation Electron flow passed: contractor and treasury trees, existing pages, bank empty state, and unchanged finance tables.');