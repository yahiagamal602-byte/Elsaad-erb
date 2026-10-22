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
  const image = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
  const directory = join(userData, 'screenshots');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.png`), Buffer.from(image.data, 'base64'));
}

async function createAccount(code, name, type, parentId = '') {
  const existing = (await evaluate('window.elsaad.listAccounts()')).find((item) => item.code === code);
  if (existing) return existing;
  console.log(`Creating account ${code}`);
  await click('[data-action="account-add"]');
  await waitFor('[data-form="account"]');
  await setField('[data-form="account"] [name="code"]', code);
  await setField('[data-form="account"] [name="name"]', name);
  await setField('[data-form="account"] [name="nameEn"]', `${code} EN`);
  await setField('[data-form="account"] [name="type"]', type);
  await setField('[data-form="account"] [name="parentId"]', parentId);
  await click('[data-form="account"] button[type="submit"]');
  await waitFor(`[data-account-search*="${code.toLocaleLowerCase('ar')}"]`);
  const account = (await evaluate('window.elsaad.listAccounts()')).find((item) => item.code === code);
  assert.ok(account, `Account ${code} was not persisted.`);
  return account;
}

async function createCenter(code, name, parentId = '') {
  const existing = (await evaluate('window.elsaad.listCostCenters()')).find((item) => item.code === code);
  if (existing) return existing;
  console.log(`Creating cost center ${code}`);
  await click('[data-action="center-add"]');
  await waitFor('[data-form="cost-center"]');
  await setField('[data-form="cost-center"] [name="code"]', code);
  await setField('[data-form="cost-center"] [name="name"]', name);
  await setField('[data-form="cost-center"] [name="nameEn"]', `${code} EN`);
  await setField('[data-form="cost-center"] [name="parentId"]', parentId);
  await setField('[data-form="cost-center"] [name="type"]', 'اختبار');
  await click('[data-form="cost-center"] button[type="submit"]');
  await waitFor(`[data-center-search*="${code.toLocaleLowerCase('ar')}"]`);
  const center = (await evaluate('window.elsaad.listCostCenters()')).find((item) => item.code === code);
  assert.ok(center, `Cost center ${code} was not persisted.`);
  return center;
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
console.log('Electron session ready');
if (!(await evaluate(`document.querySelector('#accounting-subpages').hidden`))) await click('[data-action="accounting-toggle"]');
assert.equal(await evaluate(`document.querySelector('#accounting-subpages').hidden`), true);
await click('[data-action="accounting-toggle"]');
assert.equal(await evaluate(`document.querySelector('#accounting-subpages').hidden`), false);
assert.equal(await evaluate(`document.querySelectorAll('[data-accounting-view]').length`), 5);
await click('[data-accounting-view="chart-of-accounts"]');
await waitFor('[data-account-tree]');
console.log('Chart page ready');
const rootAccount = await createAccount('E2E-ACC-ROOT', 'مجموعة اختبار', 'asset');
const leafAccount = await createAccount('E2E-ACC-LEAF', 'حساب فرعي', 'asset', rootAccount.id);
const expenseAccount = await createAccount('E2E-ACC-EXP', 'مصروف اختبار', 'expense');
const revenueAccount = await createAccount('E2E-ACC-REV', 'إيراد اختبار', 'revenue');
assert.equal((await evaluate('window.elsaad.listAccounts()')).find((item) => item.id === rootAccount.id).postable, false);
console.log('Account hierarchy saved');
await setField('[data-form="account-search"] [name="search"]', 'E2E-ACC-LEAF');
assert.equal(await evaluate(`document.querySelector('[data-account-search*="e2e-acc-leaf"]').hidden`), false);
await screenshot('accounting-chart');
const duplicateAccount = await evaluate(`window.elsaad.saveAccount({code:'e2e-acc-leaf',name:'تكرار',nameEn:'',type:'asset',parentId:null,postable:true,notes:''}).then(() => 'saved', error => error.message)`);
assert.match(duplicateAccount, /مستخدم بالفعل/);
const cycleAccount = await evaluate(`window.elsaad.saveAccount({id:${rootAccount.id},code:'E2E-ACC-ROOT',name:'مجموعة اختبار',nameEn:'',type:'asset',parentId:${leafAccount.id},postable:false,notes:''}).then(() => 'saved', error => error.message)`);
assert.match(cycleAccount, /دائرية/);

await click('[data-accounting-view="cost-centers"]');
await waitFor('[data-center-tree]');
console.log('Cost-center page ready');
const rootCenter = await createCenter('E2E-CC-ROOT', 'مركز رئيسي');
const leafCenter = await createCenter('E2E-CC-LEAF', 'مركز فرعي', rootCenter.id);
assert.equal((await evaluate('window.elsaad.listCostCenters()')).find((item) => item.id === rootCenter.id).postable, false);
await setField('[data-form="center-search"] [name="search"]', 'E2E-CC-LEAF');
await screenshot('accounting-cost-centers');
const centerCycle = await evaluate(`window.elsaad.saveCostCenter({id:${rootCenter.id},code:'E2E-CC-ROOT',name:'مركز رئيسي',nameEn:'',parentId:${leafCenter.id},type:'',postable:false,notes:''}).then(() => 'saved', error => error.message)`);
assert.match(centerCycle, /دائرية/);

await click('[data-accounting-view="daily-journals"]');
await waitFor('[data-action="journal-add"]');
console.log('Journal page ready');
await click('[data-action="journal-add"]');
await waitFor('[data-form="journal"]');
await setField('[data-form="journal"] [name="date"]', '2026-10-20');
await setField('[data-form="journal"] [name="reference"]', 'E2E-ACCOUNTING-JOURNAL');
await setField('[data-form="journal"] [name="description"]', 'قيد اختبار مترابط');
assert.equal(await evaluate('document.querySelectorAll("[data-journal-line]").length'), 2);
const journalLines = await evaluate(`[...document.querySelectorAll('[data-journal-line]')].map((row) => ({account:row.querySelector('[name="accountId"]'),debit:row.querySelector('[name="debit"]'),credit:row.querySelector('[name="credit"]'),center:row.querySelector('[name="costCenterId"]')})).map((row) => ({accountValue:row.account.value,debit:row.debit.value,credit:row.credit.value,centerValue:row.center.value}))`);
assert.equal(journalLines.length, 2);
await setField('[data-journal-line]:nth-child(1) [name="accountId"]', expenseAccount.id);
await setField('[data-journal-line]:nth-child(1) [name="description"]', 'مصروف مباشر');
await setField('[data-journal-line]:nth-child(1) [name="debit"]', '100.50');
await setField('[data-journal-line]:nth-child(1) [name="credit"]', '0');
await setField('[data-journal-line]:nth-child(1) [name="costCenterId"]', leafCenter.id);
await setField('[data-journal-line]:nth-child(2) [name="accountId"]', revenueAccount.id);
await setField('[data-journal-line]:nth-child(2) [name="debit"]', '0');
await setField('[data-journal-line]:nth-child(2) [name="credit"]', '100.50');
assert.match(await evaluate(`document.querySelector('[data-journal-difference]').textContent`), /^0$/);
const journalRequest = await evaluate(`({requestKey:document.querySelector('[data-form="journal"] [name="requestKey"]').value, lines:[...document.querySelectorAll('[data-journal-line]')].map(row=>({accountId:Number(row.querySelector('[name="accountId"]').value),description:row.querySelector('[name="description"]').value,debit:row.querySelector('[name="debit"]').value,credit:row.querySelector('[name="credit"]').value,costCenterId:row.querySelector('[name="costCenterId"]').value?Number(row.querySelector('[name="costCenterId"]').value):null})),date:'2026-10-20',reference:'E2E-ACCOUNTING-JOURNAL',description:'قيد اختبار مترابط'})`);
await click('[data-form="journal"] button[type="submit"]');
await waitForGone('#journal-modal');
const posted = await evaluate(`window.elsaad.postJournalEntry(${JSON.stringify(journalRequest)}).then(entry => entry.id)`);
const journalEntries = await evaluate('window.elsaad.listJournalEntries("E2E-ACCOUNTING-JOURNAL")');
assert.equal(journalEntries.length, 1);
assert.equal(journalEntries[0].id, posted);
await setField('[data-form="journal-search"] [name="search"]', 'E2E-ACCOUNTING-JOURNAL');
await click('[data-form="journal-search"] button[type="submit"]');
await waitFor('[data-action="journal-open"]');
await click('[data-action="journal-open"]');
await waitFor('#journal-detail-modal');
const journalDetailText = await evaluate(`document.querySelector('#journal-detail-modal').innerText`);
assert.match(journalDetailText, /مركز فرعي/);
assert.match(journalDetailText, /100.5/);
await screenshot('accounting-journals');
const unbalancedPayload = {
  ...journalRequest,
  requestKey: 'E2E-ACCOUNTING-UNBALANCED',
  lines: [journalRequest.lines[0], { ...journalRequest.lines[1], credit: '100.49' }],
};
const unbalanced = await evaluate(`window.elsaad.postJournalEntry(${JSON.stringify(unbalancedPayload)}).then(() => 'saved', error => error.message)`);
assert.match(unbalanced, /غير متوازن/);
await click('[data-action="journal-detail-close"]');

await click('[data-accounting-view="budgets"]');
await waitFor('[data-action="budget-add"]');
console.log('Budget page ready');
const journalsBeforeBudget = await evaluate('window.elsaad.listJournalEntries()');
await click('[data-action="budget-add"]');
await waitFor('[data-form="budget"]');
await setField('[data-form="budget"] [name="from"]', '2026-01-01');
await setField('[data-form="budget"] [name="to"]', '2026-12-31');
await setField('[data-form="budget"] [name="costCenterId"]', leafCenter.id);
await click('[data-action="budget-line-add"]');
await click('[data-action="budget-line-add"]');
await setField('[data-budget-line]:nth-child(1) [name="accountId"]', revenueAccount.id);
await setField('[data-budget-line]:nth-child(1) [name="category"]', 'sales');
await setField('[data-budget-line]:nth-child(1) [name="amount"]', '1000');
await setField('[data-budget-line]:nth-child(2) [name="accountId"]', expenseAccount.id);
await setField('[data-budget-line]:nth-child(2) [name="category"]', 'cash-purchases');
await setField('[data-budget-line]:nth-child(2) [name="amount"]', '250');
await setField('[data-budget-line]:nth-child(3) [name="accountId"]', expenseAccount.id);
await setField('[data-budget-line]:nth-child(3) [name="category"]', 'cash-expenses');
await setField('[data-budget-line]:nth-child(3) [name="amount"]', '125');
await setField('[data-form="budget"] [name="notes"]', 'E2E accounting budget');
await click('[data-form="budget"] button[type="submit"]');
await waitForGone('#budget-modal');
let savedBudgets = await evaluate('window.elsaad.listBudgets("E2E accounting budget")');
assert.equal(savedBudgets.length, 1);
const budgetId = savedBudgets[0].id;
assert.deepEqual([savedBudgets[0].sales, savedBudgets[0].cashPurchases, savedBudgets[0].cashExpenses, savedBudgets[0].net], ['1000', '250', '125', '625']);
await setField('[data-form="budget-search"] [name="search"]', 'E2E accounting budget');
await click('[data-form="budget-search"] button[type="submit"]');
await waitFor(`[data-action="budget-edit"][data-id="${budgetId}"]`);
await click(`[data-action="budget-edit"][data-id="${budgetId}"]`);
await setField('[data-budget-line]:nth-child(1) [name="amount"]', '900');
await click('[data-form="budget"] button[type="submit"]');
await waitForGone('#budget-modal');
savedBudgets = await evaluate('window.elsaad.listBudgets("E2E accounting budget")');
assert.equal(savedBudgets[0].id, budgetId);
assert.equal(savedBudgets[0].net, '525');
const invalidRange = await evaluate(`window.elsaad.saveBudget({from:'2026-12-31',to:'2026-01-01',costCenterId:null,notes:'',lines:[]}).then(()=>'saved',error=>error.message)`);
assert.match(invalidRange, /يسبق بدايتها/);
const journalsAfterBudget = await evaluate('window.elsaad.listJournalEntries()');
assert.equal(journalsAfterBudget.length, journalsBeforeBudget.length);
await screenshot('accounting-budgets');

const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 1);
assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM budget_lines').get().count), 3);
database.close();
assert.deepEqual(runtimeErrors, []);
console.log(JSON.stringify({
  electronWindow: target.title,
  subpages: ['chart-of-accounts', 'cost-centers', 'daily-journals', 'budgets'],
  accountHierarchy: true,
  costCenterHierarchy: true,
  journalBalancedAndOpened: true,
  journalDuplicateRequestIdempotent: true,
  budgetNet: '625',
  budgetEditedSameRecord: true,
  budgetCreatesNoJournal: true,
  invalidCasesRejected: true,
  testDataRetainedInIsolatedProfileForRestartCheck: true,
  screenshots: join(userData, 'screenshots'),
}, null, 2));
socket.close();
