import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const userData = process.argv[2];
if (!userData) throw new Error('Pass an isolated Electron user-data directory.');
const targets = await (await fetch('http://127.0.0.1:9381/json/list')).json();
const target = targets.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:5173/'));
assert.ok(target, 'Electron renderer is not available.');
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
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('renderer console error');
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  }
});
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}
async function waitFor(selector) {
  await evaluate(`new Promise((resolve, reject) => {
    const find = () => document.querySelector(${JSON.stringify(selector)});
    if (find()) return resolve(true);
    const observer = new MutationObserver(() => { if (find()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timeout waiting for ' + ${JSON.stringify(selector)})); }, 15000);
  })`);
}
async function waitForText(selector, text) {
  await evaluate(`new Promise((resolve, reject) => {
    const ready = () => document.querySelector(${JSON.stringify(selector)})?.innerText.includes(${JSON.stringify(text)});
    if (ready()) return resolve(true);
    const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timeout waiting for text ' + ${JSON.stringify(text)})); }, 15000);
  })`);
}
async function click(selector) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`), true, `Missing ${selector}`);
}
async function setField(selector, value) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`), true, `Missing ${selector}`);
}
async function loginAs(username, password) {
  if (await evaluate(`Boolean(document.querySelector('.app-shell'))`)) await click('[data-action="logout"]');
  await waitFor('#login-form');
  await setField('#login-form [name="username"]', username);
  await setField('#login-form [name="password"]', password);
  await click('#login-form button[type="submit"]');
  await waitFor('.app-shell');
  return evaluate('window.elsaad.getCurrentUser()');
}
await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await evaluate('window.alert = () => {}; window.confirm = () => true;');
if (await evaluate(`Boolean(document.querySelector('#login-form'))`)) {
  await setField('#login-form [name="username"]', 'admin');
  await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
  await click('#login-form button[type="submit"]');
}
await waitFor('.app-shell');
const login = await evaluate(`window.elsaad.login({ username: 'admin', password: 'E2e#SecurePassword2026' })`);
assert.equal(login.ok, true, 'The seeded system administrator must authenticate.');
assert.equal(await evaluate(`window.elsaad.getCurrentUser().then((user) => user.systemAdmin)`), true);
assert.match(await evaluate(`document.querySelector('.user-chip').innerText`), /مدير النظام/,
  'The top bar should show the authenticated administrator identity.');

await click('[data-page="settings"]');
await waitFor('.settings-page');
const settingsTabs = await evaluate(`JSON.stringify([...document.querySelectorAll('.settings-tabs [data-settings-view]')].map((tab) => tab.dataset.settingsView))`);
assert.deepEqual(JSON.parse(settingsTabs), ['general', 'backup', 'company', 'users', 'permission-groups', 'user-permissions'],
  'All six settings tabs should appear together in the requested order.');
assert.equal(await evaluate(`document.querySelectorAll('[data-page="users"], [data-page="permission-groups"], [data-page="user-permissions"]').length`), 0,
  'The sidebar must not retain links to standalone user administration pages.');
await click('[data-settings-view="general"]');
await waitFor('form[data-form="settings-general"]');
await click('[data-settings-view="backup"]');
await waitFor('form[data-form="backup-settings"]');
await click('[data-settings-view="company"]');
await waitFor('form[data-form="company-profile"]');
await click('[data-settings-view="users"]');
await waitFor('form[data-form="managed-user"]');
assert.match(await evaluate('document.querySelector(".admin-page h2").textContent'), /المستخدمون/);
await setField('[name="fullName"]', 'تغيير غير محفوظ للاختبار');
await evaluate('window.__tabConfirmCalls = 0; window.confirm = () => { window.__tabConfirmCalls += 1; return false; };');
await click('[data-settings-view="users"]');
assert.equal(await evaluate('document.querySelector(\'[name="fullName"]\').value'), 'تغيير غير محفوظ للاختبار',
  'Clicking the active tab must not reload or discard unsaved values.');
assert.equal(await evaluate('window.__tabConfirmCalls'), 0, 'The active tab should not trigger a discard prompt.');
await click('[data-settings-view="backup"]');
assert.equal(await evaluate('document.querySelector(\'[data-settings-view="users"]\').classList.contains("is-active")'), true,
  'Declining the unsaved-changes warning must keep the current tab active.');
assert.equal(await evaluate('document.querySelector(\'[name="fullName"]\').value'), 'تغيير غير محفوظ للاختبار',
  'Declining the warning must preserve unsaved form values.');
assert.equal(await evaluate('window.__tabConfirmCalls'), 1, 'Changing tabs with unsaved changes must prompt the user.');
await evaluate('window.confirm = () => true;');
await click('[data-action="users-new"]');
await waitFor('form[data-form="managed-user"]');
await setField('[name="username"]', 'qa_operator');
await setField('[name="fullName"]', 'مختبر الصلاحيات');
await setField('[name="email"]', 'operator@example.invalid');
await setField('[name="password"]', 'TestPassword!2026');
await setField('[name="confirmPassword"]', 'TestPassword!2026');
await click('form[data-form="managed-user"] button[type="submit"]');
await waitForText('tbody', 'qa_operator');
const testUser = await evaluate(`window.elsaad.listManagedUsers().then((users) => users.find((user) => user.username === 'qa_operator'))`);
assert.ok(testUser?.id, 'The newly created user should be persisted and listed.');
assert.equal(testUser.systemAdmin, false, 'A normal new user must not be an administrator.');
const initialRights = await evaluate(`window.elsaad.getUserPermissionState(${testUser.id})`);
assert.ok(initialRights.effective.includes('sales.view'), 'The default group grants operational access.');
assert.ok(!initialRights.effective.some((key) => key.startsWith('settings.')), 'Operational defaults must not grant settings administration.');
assert.ok(!initialRights.effective.some((key) => key.startsWith('users.')), 'Operational defaults must not grant user administration.');

const newGroup = await evaluate(`window.elsaad.savePermissionGroup({
  name: 'مجموعة اختبار مقيدة', description: 'اختبار معزول', active: true, permissions: ['dashboard.view', 'sales.view']
})`);
assert.ok(newGroup.id, 'Permission group should be saved.');
await click('[data-settings-view="permission-groups"]');
await waitFor('form[data-form="permission-group"]');
assert.match(await evaluate('document.querySelector(".admin-page h2").textContent'), /مجموعات الصلاحيات/);
assert.ok(await evaluate(`document.querySelector(".group-list").innerText.includes('مجموعة اختبار مقيدة')`));
await click('[data-settings-view="user-permissions"]');
await waitFor('form[data-form="user-permissions"]');
await setField('[data-permission-user]', testUser.id);
await waitForText('.permission-user-summary', 'qa_operator');
await click('form[data-form="user-permissions"] input[value="sales.view"]');
await click('form[data-form="user-permissions"] button[type="submit"]');
const savedRights = await evaluate(`window.elsaad.getUserPermissionState(${testUser.id})`);
assert.ok(!savedRights.effective.includes('sales.view'), 'The user permission override should persist after page refresh.');

const brokerageGroup = await evaluate(`window.elsaad.savePermissionGroup({
  name: 'مجموعة اختبار السمسرة', description: 'صلاحيات السمسرة فقط', active: true,
  permissions: ['brokerage.view', 'brokerage.create', 'brokerage.edit', 'brokerage.delete']
})`);
const noAccessGroup = await evaluate(`window.elsaad.savePermissionGroup({
  name: 'مجموعة اختبار بلا صلاحيات', description: 'اختبار منع الوصول', active: true, permissions: []
})`);
const brokerageCreatorGroup = await evaluate(`window.elsaad.savePermissionGroup({
  name: 'مجموعة اختبار إنشاء السمسرة', description: 'عرض وإنشاء دون تعديل أو حذف', active: true,
  permissions: ['brokerage.view', 'brokerage.create']
})`);
const projectsGroup = await evaluate(`window.elsaad.savePermissionGroup({
  name: 'مجموعة اختبار المشاريع', description: 'صلاحيات المشاريع دون السمسرة', active: true,
  permissions: ['projects.view', 'projects.create', 'projects.edit', 'projects.delete']
})`);
const [brokerageUser, brokerageCreatorUser, projectsUser, project, existingBroker, noAccessUser] = await evaluate(`Promise.all([
  window.elsaad.saveManagedUser({
    username: 'qa_brokerage', fullName: 'مختبر السمسرة', email: '', phone: '', groupId: ${brokerageGroup.id},
    active: true, systemAdmin: false, password: 'BrokerageTest!2026', notes: ''
  }),
  window.elsaad.saveManagedUser({
    username: 'qa_brokerage_creator', fullName: 'مختبر إنشاء السمسرة', email: '', phone: '',
    groupId: ${brokerageCreatorGroup.id}, active: true, systemAdmin: false,
    password: 'BrokerCreator!2026', notes: ''
  }),
  window.elsaad.saveManagedUser({
    username: 'qa_projects', fullName: 'مختبر المشاريع', email: '', phone: '', groupId: ${projectsGroup.id},
    active: true, systemAdmin: false, password: 'ProjectsTest!2026', notes: ''
  }),
  window.elsaad.saveProject({
    code: 'E2E-PERM-PROJECT', name: 'مشروع اختبار الصلاحيات', startDate: '2026-01-01',
    endDate: '', costCenter: '', status: 'new'
  }),
  window.elsaad.savePropertyBroker({
    code: 'E2E-PERM-BROKER', name: 'سمسار اختبار الصلاحيات', phone: '', commissionRate: '2.5', status: 'active'
  }),
  window.elsaad.saveManagedUser({
    username: 'qa_no_access', fullName: 'مختبر بلا صلاحيات', email: '', phone: '',
    groupId: ${noAccessGroup.id}, active: true, systemAdmin: false,
    password: 'NoAccess!2026', notes: ''
  })
])`);
const existingUnit = await evaluate(`window.elsaad.savePropertyUnit({
  projectId: ${project.id}, code: 'E2E-PERM-UNIT', name: 'وحدة اختبار الصلاحيات',
  floor: '', area: '100', originalPrice: '100000', status: 'available'
})`);

const regularUser = await loginAs('qa_operator', 'TestPassword!2026');
assert.equal(regularUser.username, 'qa_operator', 'The new user must be able to log in.');
assert.match(await evaluate(`document.querySelector('.user-chip').innerText`), /مختبر الصلاحيات/,
  'The top bar should update to the authenticated regular user after login.');
assert.equal(await evaluate(`window.elsaad.listSalesDocuments('invoice').then(() => false).catch(() => true)`), true,
  'The backend must deny a sales operation after its view permission was revoked.');
assert.equal(await evaluate(`window.elsaad.listManagedUsers().then(() => false).catch(() => true)`), true,
  'The backend must deny user administration to a regular account.');
assert.equal(await evaluate(`window.elsaad.getDashboardSummary().then(() => true)`), true,
  'The default operational permissions retain dashboard access.');
await evaluate('window.elsaad.logout()');

const brokerageSignedIn = await loginAs('qa_brokerage', 'BrokerageTest!2026');
assert.equal(brokerageSignedIn.username, 'qa_brokerage');
assert.equal(await evaluate('window.elsaad.getLandingPage()'), 'brokerage',
  'A brokerage-only user should land on the first module they are allowed to view.');
assert.match(await evaluate(`document.querySelector('.user-chip').innerText`), /مختبر السمسرة/);
assert.ok(await evaluate(`window.elsaad.listPropertyBrokers('E2E-PERM-BROKER').then((brokers) => brokers.some((broker) => broker.id === ${existingBroker.id}))`),
  'A brokerage-only user can read brokers.');
const createdBroker = await evaluate(`window.elsaad.savePropertyBroker({
  code: 'E2E-PERM-CREATED', name: 'سمسار مسموح', phone: '', commissionRate: '3', status: 'active'
})`);
assert.ok(createdBroker.id, 'A brokerage-only user with create permission can add a broker.');
const updatedBroker = await evaluate(`window.elsaad.savePropertyBroker({
  id: ${createdBroker.id}, code: 'E2E-PERM-CREATED', name: 'سمسار معدل', phone: '',
  commissionRate: '4', status: 'active'
})`);
assert.equal(updatedBroker.name, 'سمسار معدل', 'A brokerage-only user with edit permission can update a broker.');
assert.equal(await evaluate(`window.elsaad.deletePropertyBroker(${createdBroker.id})`), true,
  'A brokerage-only user with delete permission can remove an unused broker.');
assert.equal(await evaluate('window.elsaad.listProjects().then(() => false, () => true)'), true,
  'Brokerage permissions alone do not grant access to projects.');
await evaluate('window.elsaad.logout()');

assert.equal((await evaluate(`window.elsaad.login({ username: 'qa_brokerage_creator', password: 'BrokerCreator!2026' })`)).ok, true);
const createOnlyBroker = await evaluate(`window.elsaad.savePropertyBroker({
  code: 'E2E-PERM-CREATE-ONLY', name: 'سمسار إنشاء فقط', phone: '', commissionRate: '1', status: 'active'
})`);
assert.ok(createOnlyBroker.id, 'brokerage.create permits creation.');
assert.equal(await evaluate(`window.elsaad.savePropertyBroker({
  id: ${existingBroker.id}, code: 'E2E-PERM-BROKER', name: 'تعديل دون صلاحية', phone: '',
  commissionRate: '2.5', status: 'active'
}).then(() => false, () => true)`), true, 'brokerage.create does not grant brokerage.edit.');
assert.equal(await evaluate(`window.elsaad.deletePropertyBroker(${createOnlyBroker.id}).then(() => false, () => true)`), true,
  'brokerage.create does not grant brokerage.delete.');
await evaluate('window.elsaad.logout()');

const projectsSignedIn = await loginAs('qa_projects', 'ProjectsTest!2026');
assert.equal(projectsSignedIn.username, 'qa_projects');
assert.equal(await evaluate('window.elsaad.getLandingPage()'), 'projects',
  'A projects-only user should land on the projects module.');
assert.match(await evaluate(`document.querySelector('.user-chip').innerText`), /مختبر المشاريع/);
assert.equal(await evaluate(`window.elsaad.listPropertyBrokers().then(() => false, () => true)`), true,
  'A projects-only user cannot read brokers.');
assert.equal(await evaluate(`window.elsaad.savePropertyBroker({
  code: 'E2E-PERM-DENIED', name: 'غير مسموح', phone: '', commissionRate: '0', status: 'active'
}).then(() => false, () => true)`), true, 'A projects-only user cannot create brokers.');
assert.equal(await evaluate(`window.elsaad.savePropertyBroker({
  id: ${existingBroker.id}, code: 'E2E-PERM-BROKER', name: 'تعديل غير مسموح', phone: '',
  commissionRate: '2.5', status: 'active'
}).then(() => false, () => true)`), true, 'A projects-only user cannot edit brokers.');
assert.equal(await evaluate(`window.elsaad.deletePropertyBroker(${existingBroker.id}).then(() => false, () => true)`), true,
  'A projects-only user cannot delete brokers.');
assert.ok(await evaluate(`window.elsaad.listPropertyUnits(${project.id}).then((units) => units.some((unit) => unit.id === ${existingUnit.id}))`),
  'Project permissions continue to allow reading project units.');
const updatedUnit = await evaluate(`window.elsaad.savePropertyUnit({
  id: ${existingUnit.id}, projectId: ${project.id}, code: 'E2E-PERM-UNIT', name: 'وحدة مشروع معدلة',
  floor: '', area: '100', originalPrice: '100000', status: 'available'
})`);
assert.equal(updatedUnit.name, 'وحدة مشروع معدلة', 'Project permissions continue to allow editing project units.');
assert.ok(Array.isArray(await evaluate('window.elsaad.listPropertyContracts()')),
  'Project permissions continue to allow reading property contracts.');
await evaluate('window.elsaad.logout()');

await click('[data-action="logout"]');
await waitFor('#login-form');
await setField('#login-form [name="username"]', 'qa_no_access');
await setField('#login-form [name="password"]', 'NoAccess!2026');
await click('#login-form button[type="submit"]');
await waitForText('.login-card h1', 'لا توجد صلاحية للوصول');
assert.equal(await evaluate('window.elsaad.getCurrentUser().then((user) => user.id)'), noAccessUser.id);
assert.equal(await evaluate('window.elsaad.getLandingPage()'), null,
  'A user with no view permissions should receive a clear no-access screen.');
await click('.login-card [data-action="logout"]');
await waitFor('#login-form');

await loginAs('admin', 'E2e#SecurePassword2026');
await evaluate(`window.elsaad.deletePropertyBroker(${createOnlyBroker.id})`);
await evaluate(`window.elsaad.saveRecord({
  module: 'reports', title: 'سجل اختبار التفريغ المعزول', reference: '', party: '', date: '', amount: '', status: 'new', notes: ''
})`);
assert.equal(await evaluate(`window.elsaad.listRecords('reports').then((rows) => rows.length)`), 1);
await evaluate(`window.__resetAlerts = []; window.alert = (message) => window.__resetAlerts.push(String(message));
  window.prompt = () => 'تفريغ بيانات التشغيل'; window.confirm = () => true;`);
await click('[data-page="settings"]');
await waitFor('.settings-page');
await click('[data-settings-view="general"]');
await waitFor('[data-action="program-data-reset"]');
await click('[data-action="program-data-reset"]');
const resetAlert = await evaluate(`new Promise((resolve, reject) => {
  const start = Date.now();
  const timer = setInterval(() => {
    if (window.__resetAlerts.length) { clearInterval(timer); resolve(window.__resetAlerts.at(-1)); }
    else if (Date.now() - start > 15000) { clearInterval(timer); reject(new Error('Data reset did not finish in time.')); }
  }, 50);
})`);
assert.match(resetAlert, /اكتمل التفريغ/);
assert.match(resetAlert, /elsaad-backup-/);
assert.equal(await evaluate(`window.elsaad.listRecords('reports').then((rows) => rows.length)`), 0);
assert.ok((await evaluate('window.elsaad.listManagedUsers()')).some((user) => user.username === 'qa_operator'),
  'Program-data reset must preserve user accounts.');
const backups = readdirSync(join(userData, 'backups')).filter((name) => name.endsWith('.sqlite'));
assert.ok(backups.length > 0, 'A safety backup must exist before data reset.');
const backupDb = new DatabaseSync(join(userData, 'backups', backups[0]), { readOnly: true });
assert.equal(backupDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
assert.equal(Number(backupDb.prepare('SELECT COUNT(*) AS count FROM users').get().count), 6,
  'The safety backup should retain the administrator and all isolated permission-test users.');
backupDb.close();
const liveDb = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
assert.equal(Number(liveDb.prepare('SELECT COUNT(*) AS count FROM data_reset_history').get().count), 1);
assert.equal(liveDb.prepare("SELECT value FROM app_settings WHERE key = 'theme'").get().value, 'light',
  'Program-data reset must preserve system settings.');
liveDb.close();
assert.deepEqual(errors, [], 'The renderer should not emit uncaught errors.');
socket.close();
console.log(`Isolated user and permission Electron test passed for ${userData}.`);
