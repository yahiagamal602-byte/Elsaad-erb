import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const userData = process.argv[2];
const stage = process.argv[3] ?? 'verify';
const port = process.env.ELSAAD_CDP_PORT ?? '9223';
if (!userData) throw new Error('Pass the isolated accounting test profile.');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer window was not found.');
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
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
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
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out: ' + ${JSON.stringify(selector)})); }, 20000);
  })`);
}
async function waitForGone(selector) {
  await evaluate(`new Promise((resolve, reject) => {
    if (!document.querySelector(${JSON.stringify(selector)})) return resolve(true);
    const observer = new MutationObserver(() => {
      if (!document.querySelector(${JSON.stringify(selector)})) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out removing: ' + ${JSON.stringify(selector)})); }, 20000);
  })`);
}
async function click(selector) {
  assert.equal(await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`), true, `Missing ${selector}`);
}
async function capture(name) {
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
  const directory = join(userData, 'screenshots');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
if (await evaluate(`Boolean(document.querySelector('#login-form'))`)) {
  const set = async (selector, value) => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return true })()`);
  await set('#login-form [name="username"]', 'admin');
  await set('#login-form [name="password"]', 'E2e#SecurePassword2026');
  await click('#login-form button[type="submit"]');
}
await waitFor('.app-shell');

if (stage === 'layout') {
  await click('[data-accounting-view="budgets"]');
  await waitFor('[data-action="budget-add"]');
  const geometry = await evaluate(`(() => {
    const rect = (selector) => { const el = document.querySelector(selector); const box = el?.getBoundingClientRect(); return box ? {left:box.left,right:box.right,width:box.width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth} : null; };
    return { viewport:{width:innerWidth,scrollWidth:document.documentElement.scrollWidth}, app:rect('#app'), shell:rect('.app-shell'), sidebar:rect('.sidebar'), main:rect('.main-area'), content:rect('.page-content'), heading:rect('.section-heading--page'), title:rect('.section-heading--page h1'), toolbar:rect('.section-heading--page .toolbar-actions'), panel:rect('.budget-table') };
  })()`);
  assert.ok(geometry.heading && geometry.content && geometry.heading.left >= geometry.content.left - 1
    && geometry.heading.right <= geometry.content.right + 1, `Accounting page heading overflows its content: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.toolbar && geometry.toolbar.left >= geometry.content.left - 1
    && geometry.toolbar.right <= geometry.content.right + 1, `Accounting toolbar overflows its content: ${JSON.stringify(geometry)}`);
  await capture('accounting-layout-after-fix');
  console.log(JSON.stringify(geometry, null, 2));
} else if (stage === 'delete') {
  await click('[data-accounting-view="budgets"]');
  await waitFor('[data-action="budget-add"]');
  const budgets = await evaluate('window.elsaad.listBudgets("E2E accounting budget")');
  assert.equal(budgets.length, 1);
  const budgetId = budgets[0].id;
  await evaluate('window.confirm = () => true');
  await click(`[data-action="budget-delete"][data-id="${budgetId}"]`);
  await waitForGone(`[data-action="budget-edit"][data-id="${budgetId}"]`);
  assert.equal((await evaluate('window.elsaad.listBudgets("E2E accounting budget")')).length, 0);
  const account = (await evaluate('window.elsaad.listAccounts()')).find((item) => item.code === 'E2E-ACC-EXP');
  const center = (await evaluate('window.elsaad.listCostCenters()')).find((item) => item.code === 'E2E-CC-LEAF');
  assert.match(await evaluate(`window.elsaad.deleteAccount(${account.id}).then(()=>'deleted',error=>error.message)`), /قيود/);
  assert.match(await evaluate(`window.elsaad.deleteCostCenter(${center.id}).then(()=>'deleted',error=>error.message)`), /قيود/);
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ stage, budgetDeleteConfirmed: true, referencedAccountAndCenterProtected: true }, null, 2));
} else if (stage === 'verify') {
  const accounts = await evaluate('window.elsaad.listAccounts()');
  const centers = await evaluate('window.elsaad.listCostCenters()');
  const journal = (await evaluate('window.elsaad.listJournalEntries("E2E-ACCOUNTING-JOURNAL")'))[0];
  assert.ok(accounts.some((item) => item.code === 'E2E-ACC-LEAF'));
  assert.ok(centers.some((item) => item.code === 'E2E-CC-LEAF'));
  assert.ok(journal);
  const detail = await evaluate(`window.elsaad.getJournalEntry(${journal.id})`);
  assert.equal(detail.lines.length, 2);
  assert.equal(detail.totalDebit, '100.5');
  assert.equal(detail.totalCredit, '100.5');
  assert.equal((await evaluate('window.elsaad.listBudgets("E2E accounting budget")')).length, 0);
  await click('[data-accounting-view="chart-of-accounts"]');
  await waitFor('[data-account-tree]');
  await capture('accounting-persisted-chart');
  await click('[data-accounting-view="cost-centers"]');
  await waitFor('[data-center-tree]');
  await capture('accounting-persisted-centers');
  await click('[data-accounting-view="daily-journals"]');
  await waitFor('[data-action="journal-open"]');
  await capture('accounting-persisted-journals');
  assert.deepEqual(runtimeErrors, []);
  console.log(JSON.stringify({ stage, persistedAccounts: accounts.length, persistedCenters: centers.length, persistedJournalId: journal.id, postedJournalBalanced: true, screenshots: join(userData, 'screenshots') }, null, 2));
} else {
  throw new Error(`Unknown stage ${stage}`);
}
socket.close();
