import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const userData = process.argv[2];
const phase = process.argv[3] ?? 'write';
if (!userData) throw new Error('Pass the isolated Electron user-data directory as the first argument.');
const targets = await (await fetch('http://127.0.0.1:9381/json/list')).json();
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

async function waitForText(selector, text) {
  await evaluate(`new Promise((resolve, reject) => {
    const ready = () => document.querySelector(${JSON.stringify(selector)})?.innerText.includes(${JSON.stringify(text)});
    if (ready()) return resolve(true);
    const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); clearTimeout(timer); resolve(true); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Timed out waiting for text ' + ${JSON.stringify(text)})); }, 20000);
  })`);
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`), true, `Missing control ${selector}`);
}

async function setField(selector, value) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(String(value))}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`), true, `Missing field ${selector}`);
}

await cdp('Page.enable');
await cdp('Runtime.enable');
await (await import('./initial-setup-helper.mjs')).completeInitialSetup(evaluate);
await evaluate('window.alert = () => {};');
if (await evaluate(`Boolean(document.querySelector('#login-form'))`)) {
  await waitFor('#login-form');
  await setField('#login-form [name="username"]', 'admin');
  await setField('#login-form [name="password"]', 'E2e#SecurePassword2026');
  await click('#login-form button[type="submit"]');
}
await waitFor('.app-shell');
await click('[data-page="settings"]');
await waitFor('.settings-page');

if (phase === 'write') {
  await click('[data-settings-view="general"]');
  await setField('form[data-form="settings-general"] [name="theme"]', 'dark');
  await setField('form[data-form="settings-general"] [name="invoicePrefix"]', 'TST');
  await click('form[data-form="settings-general"] button[type="submit"]');
  await waitFor('.settings-tabs');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  assert.deepEqual(await evaluate('window.elsaad.getGeneralSettings()'), { theme: 'dark', invoicePrefix: 'TST' });
  assert.equal(await evaluate(`window.elsaad.saveGeneralSettings({ theme: 'light', invoicePrefix: 'bad prefix' }).then(() => false).catch(() => true)`), true,
    'An invalid invoice prefix must be rejected.');

  const numberingDb = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  const sourceResult = numberingDb.prepare(`
    INSERT INTO sales_documents (document_type, document_number, client_name, document_date, status)
    VALUES ('certificate', 'TEST-CERT-000001', 'عميل اختبار الترقيم', date('now'), 'approved')
  `).run();
  numberingDb.prepare(`
    INSERT INTO sales_document_lines (document_id, line_order, description, unit, quantity, current_quantity, unit_price)
    VALUES (?, 1, 'بند اختبار الترقيم', 'عدد', '1', '1', '1')
  `).run(Number(sourceResult.lastInsertRowid));
  numberingDb.close();
  assert.equal(await evaluate(`window.elsaad.createSalesDocumentFrom(${Number(sourceResult.lastInsertRowid)}, 'invoice').then((invoice) => invoice.number)`),
    'TST-000002', 'New invoice numbers must use the configured prefix.');

  await click('[data-settings-view="company"]');
  await waitFor('form[data-form="company-profile"]');
  const logoPath = join(userData, 'test-logo.png');
  writeFileSync(logoPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'));
  await click('[data-action="company-logo-choose"]');
  await waitFor('.company-logo-preview img');
  await setField('form[data-form="company-profile"] [name="nameAr"]', 'شركة الاختبار المعزول');
  await setField('form[data-form="company-profile"] [name="nameEn"]', 'Isolated Test Company');
  await setField('form[data-form="company-profile"] [name="addressAr"]', 'القاهرة');
  await setField('form[data-form="company-profile"] [name="addressEn"]', 'Cairo');
  await setField('form[data-form="company-profile"] [name="email"]', 'test@example.invalid');
  await setField('form[data-form="company-profile"] [name="phone"]', '+201000000000');
  await setField('form[data-form="company-profile"] [name="commercialRegister"]', 'CR-TEST');
  await setField('form[data-form="company-profile"] [name="taxNumber"]', 'TAX-TEST');
  await click('form[data-form="company-profile"] button[type="submit"]');
  await waitFor('form[data-form="company-profile"]');
  assert.equal(await evaluate(`window.elsaad.getReportLibrary().then((library) => library.entityName)`), 'شركة الاختبار المعزول',
    'The saved company name should be used by report headers.');
  writeFileSync(logoPath, Buffer.from('not an image'));
  assert.equal(await evaluate(`window.elsaad.uploadCompanyLogo().then(() => false).catch(() => true)`), true,
    'The logo upload must reject invalid image content.');
  assert.match(await evaluate(`window.elsaad.getCompanyProfile().then((profile) => profile.logoDataUrl)`), /^data:image\/png;base64,/,
    'A failed logo upload must leave the existing logo intact.');

  await click('[data-settings-view="backup"]');
  await waitFor('form[data-form="backup-settings"]');
  await setField('form[data-form="backup-settings"] [name="automatic"]', 'true');
  await setField('form[data-form="backup-settings"] [name="intervalHours"]', '24');
  await setField('form[data-form="backup-settings"] [name="retentionCount"]', '3');
  await click('form[data-form="backup-settings"] button[type="submit"]');
  await waitFor('form[data-form="backup-settings"]');
  await click('[data-action="backup-now"]');
  await waitFor('.settings-history-table .backup-status--success');

  const backupDirectory = join(userData, 'backups');
  assert.ok(existsSync(backupDirectory), 'The backup directory was not created.');
  const backupFile = readdirSync(backupDirectory).find((name) => name.endsWith('.sqlite'));
  assert.ok(backupFile, 'The backup file was not written.');
  const backupDb = new DatabaseSync(join(backupDirectory, backupFile), { readOnly: true });
  assert.equal(backupDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(backupDb.prepare("SELECT value FROM app_settings WHERE key = 'company_name'").get().value, 'شركة الاختبار المعزول');
  assert.equal(backupDb.prepare("SELECT value FROM app_settings WHERE key = 'invoice_prefix'").get().value, 'TST');
  assert.ok(backupDb.prepare("SELECT value FROM app_settings WHERE key = 'company_logo_base64'").get().value);
  backupDb.close();

  await click('[data-action="backup-choose-restore"]');
  await waitFor('.restore-file .backup-status--success');
  assert.match(await evaluate(`document.querySelector('[data-restore-file]').innerText`), /elsaad-backup-/);
  const currentDb = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  assert.equal(Number(currentDb.prepare("SELECT COUNT(*) AS count FROM backup_history WHERE kind = 'restore'").get().count), 0,
    'Choosing a restore file must not execute the restore.');
  currentDb.close();
} else if (phase === 'verify') {
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark', 'The theme setting did not persist after restart.');
  assert.deepEqual(await evaluate('window.elsaad.getGeneralSettings()'), { theme: 'dark', invoicePrefix: 'TST' },
    'The general settings did not persist after restart.');
  await click('[data-settings-view="general"]');
  await waitFor('form[data-form="settings-general"]');
  assert.equal(await evaluate(`document.querySelector('[name="invoicePrefix"]').value`), 'TST');
  await click('[data-settings-view="company"]');
  await waitFor('form[data-form="company-profile"]');
  assert.equal(await evaluate(`document.querySelector('[name="nameAr"]').value`), 'شركة الاختبار المعزول');
  assert.equal(await evaluate(`document.querySelector('[name="nameEn"]').value`), 'Isolated Test Company');
  assert.equal(await evaluate(`document.querySelector('[name="taxNumber"]').value`), 'TAX-TEST');
  assert.match(await evaluate(`document.querySelector('.company-logo-preview img').src`), /^data:image\/png;base64,/);
  await click('[data-settings-view="backup"]');
  await waitFor('form[data-form="backup-settings"]');
  assert.equal(await evaluate(`document.querySelector('[name="automatic"]').value`), 'true');
  assert.equal(await evaluate(`document.querySelector('[name="retentionCount"]').value`), '3');
  assert.ok(Number(await evaluate(`document.querySelector('.settings-history-table tbody tr td:nth-child(3)').textContent.length`)) > 0);

  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM backup_history WHERE status = 'success' AND kind = 'manual'").get().count), 1);
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM backup_history WHERE kind = 'restore'").get().count), 0);
  database.close();
} else if (phase === 'restore') {
  await click('[data-page="settings"]');
  await waitFor('.settings-page');
  await click('[data-settings-view="backup"]');
  await waitFor('form[data-form="backup-settings"]');
  await click('[data-action="backup-choose-restore"]');
  await waitFor('.restore-file .backup-status--success');
  for (const name of readdirSync(join(userData, 'company'))) rmSync(join(userData, 'company', name), { force: true });
  await evaluate('window.elsaad.setTheme("light")');
  await evaluate('window.confirm = () => true;');
  await click('[data-action="backup-restore"]');
  await waitForText('.settings-history-table', 'نسخة أمان أُنشئت قبل الاستعادة.');
  await waitForText('.settings-history-table', 'اكتملت الاستعادة.');
  await click('[data-settings-view="company"]');
  await waitFor('form[data-form="company-profile"]');
  assert.equal(await evaluate(`document.querySelector('[name="nameAr"]').value`), 'شركة الاختبار المعزول');
  assert.match(await evaluate(`document.querySelector('.company-logo-preview img').src`), /^data:image\/png;base64,/);
  assert.equal(await evaluate('window.elsaad.getTheme()'), 'dark', 'Restore should recover the saved settings snapshot.');
  assert.deepEqual(await evaluate('window.elsaad.getGeneralSettings()'), { theme: 'dark', invoicePrefix: 'TST' },
    'Restore should recover the saved invoice prefix.');
  const logoDirectory = join(userData, 'company');
  assert.ok(readdirSync(logoDirectory).some((name) => name.endsWith('.png')), 'The logo image was not restored from SQLite backup data.');

  const database = new DatabaseSync(join(userData, 'elsaad-erp.sqlite'));
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM backup_history WHERE kind = 'restore' AND status = 'success'").get().count), 1);
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM backup_history WHERE kind = 'pre-restore' AND status = 'success'").get().count), 1);
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM journal_entries').get().count), 0);
  database.close();
  const backups = readdirSync(join(userData, 'backups')).filter((name) => name.endsWith('.sqlite'));
  assert.equal(backups.length, 2, 'The source and pre-restore safety backup should both remain available.');
  for (const backupName of backups) {
    const backupDb = new DatabaseSync(join(userData, 'backups', backupName), { readOnly: true });
    assert.equal(backupDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    backupDb.close();
  }
} else {
  throw new Error(`Unknown test phase: ${phase}`);
}

assert.deepEqual(consoleErrors, []);
socket.close();
console.log(`Settings Electron phase '${phase}' passed.`);
