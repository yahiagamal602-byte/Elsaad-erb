import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { formatAmount, normalizeAmount, parseAmount } from '../src/shared/accounting.js';
import type {
  Asset, AssetDepreciationLine, AssetDepreciationReport, AssetDepreciationRun, AssetGroup, AssetGroupInput,
  AssetInput,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;

export function installAssetSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS asset_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      asset_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      accumulated_depreciation_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      depreciation_expense_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS fixed_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      group_id INTEGER NOT NULL REFERENCES asset_groups(id) ON DELETE RESTRICT,
      purchase_date TEXT NOT NULL,
      purchase_value TEXT NOT NULL,
      salvage_value TEXT NOT NULL,
      useful_life_years INTEGER NOT NULL CHECK (useful_life_years BETWEEN 1 AND 100),
      depreciation_method TEXT NOT NULL CHECK (depreciation_method = 'straight-line'),
      asset_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      accumulated_depreciation_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      depreciation_expense_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS fixed_assets_group ON fixed_assets(group_id, code);
    CREATE TABLE IF NOT EXISTS asset_depreciation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      journal_entry_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(starts_on, ends_on)
    );
    CREATE TABLE IF NOT EXISTS asset_depreciation_lines (
      run_id INTEGER NOT NULL REFERENCES asset_depreciation_runs(id) ON DELETE RESTRICT,
      asset_id INTEGER NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
      amount TEXT NOT NULL,
      PRIMARY KEY(run_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS asset_depreciation_lines_asset ON asset_depreciation_lines(asset_id, run_id);
  `);
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateRange(value: unknown): { from: string; to: string } {
  if (!value || typeof value !== 'object') throw new Error('فترة الإهلاك غير صالحة.');
  const { from, to } = value as { from?: unknown; to?: unknown };
  if (typeof from !== 'string' || !isValidDate(from) || typeof to !== 'string' || !isValidDate(to) || from > to) {
    throw new Error('حدد فترة إهلاك صحيحة من تاريخ إلى تاريخ.');
  }
  return { from, to };
}

function validId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} غير صالح.`);
  return Number(value);
}

function assertAccount(database: DatabaseSync, id: number, type: 'asset' | 'expense', label: string): void {
  const row = database.prepare(`SELECT account_type, postable, EXISTS(SELECT 1 FROM accounts child WHERE child.parent_id = accounts.id) AS has_children
    FROM accounts WHERE id = ?`).get(id) as Row | undefined;
  if (!row || row.account_type !== type || Number(row.postable) !== 1 || Number(row.has_children) === 1) {
    throw new Error(`${label} يجب أن يكون حسابًا تفصيليًا قابلًا للترحيل من نوع ${type === 'asset' ? 'الأصول' : 'المصروفات'}.`);
  }
}

function asGroup(row: Row): AssetGroup {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), nameEn: String(row.name_en),
    assetAccountId: Number(row.asset_account_id), accumulatedDepreciationAccountId: Number(row.accumulated_depreciation_account_id),
    depreciationExpenseAccountId: Number(row.depreciation_expense_account_id), notes: String(row.notes),
    assetCount: Number(row.asset_count), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function asAsset(row: Row): Asset {
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), nameEn: String(row.name_en), groupId: Number(row.group_id),
    purchaseDate: String(row.purchase_date), purchaseValue: String(row.purchase_value), salvageValue: String(row.salvage_value),
    usefulLifeYears: Number(row.useful_life_years), depreciationMethod: 'straight-line',
    assetAccountId: Number(row.asset_account_id), accumulatedDepreciationAccountId: Number(row.accumulated_depreciation_account_id),
    depreciationExpenseAccountId: Number(row.depreciation_expense_account_id), status: String(row.status) as Asset['status'],
    notes: String(row.notes), groupCode: String(row.group_code), groupName: String(row.group_name),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function groupRows(database: DatabaseSync, search = ''): AssetGroup[] {
  return (database.prepare(`SELECT groups.*, COUNT(assets.id) AS asset_count FROM asset_groups groups
    LEFT JOIN fixed_assets assets ON assets.group_id = groups.id
    WHERE ? = '' OR groups.code LIKE '%' || ? || '%' OR groups.name LIKE '%' || ? || '%' OR groups.name_en LIKE '%' || ? || '%'
    GROUP BY groups.id ORDER BY groups.code, groups.id`).all(search, search, search, search) as Row[]).map(asGroup);
}

function assetRows(database: DatabaseSync, search = ''): Asset[] {
  return (database.prepare(`SELECT assets.*, groups.code AS group_code, groups.name AS group_name FROM fixed_assets assets
    INNER JOIN asset_groups groups ON groups.id = assets.group_id
    WHERE ? = '' OR assets.code LIKE '%' || ? || '%' OR assets.name LIKE '%' || ? || '%' OR assets.name_en LIKE '%' || ? || '%'
      OR groups.code LIKE '%' || ? || '%' OR groups.name LIKE '%' || ? || '%'
    ORDER BY assets.code, assets.id`).all(search, search, search, search, search, search) as Row[]).map(asAsset);
}

function validateGroup(database: DatabaseSync, value: unknown): AssetGroupInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات مجموعة الأصول غير صالحة.');
  const input = value as Partial<AssetGroupInput>;
  const id = input.id === undefined ? undefined : validId(input.id, 'رقم المجموعة');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود مجموعة لا يتجاوز 40 حرفًا.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم المجموعة.');
  if (typeof input.nameEn !== 'string' || input.nameEn.length > 180 || typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('بيانات المجموعة النصية غير صالحة.');
  const assetAccountId = validId(input.assetAccountId, 'حساب الأصل');
  const accumulatedDepreciationAccountId = validId(input.accumulatedDepreciationAccountId, 'حساب مجمع الإهلاك');
  const depreciationExpenseAccountId = validId(input.depreciationExpenseAccountId, 'حساب مصروف الإهلاك');
  assertAccount(database, assetAccountId, 'asset', 'حساب الأصل');
  assertAccount(database, accumulatedDepreciationAccountId, 'asset', 'حساب مجمع الإهلاك');
  assertAccount(database, depreciationExpenseAccountId, 'expense', 'حساب مصروف الإهلاك');
  if (new Set([assetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId]).size !== 3) throw new Error('يجب اختيار حساب مستقل لكل غرض محاسبي.');
  return { ...(id === undefined ? {} : { id }), code: input.code.trim(), name: input.name.trim(), nameEn: input.nameEn.trim(),
    assetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId, notes: input.notes.trim() };
}

function validateAsset(database: DatabaseSync, value: unknown): AssetInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات الأصل غير صالحة.');
  const input = value as Partial<AssetInput>;
  const id = input.id === undefined ? undefined : validId(input.id, 'رقم الأصل');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود أصل لا يتجاوز 40 حرفًا.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم الأصل.');
  if (typeof input.nameEn !== 'string' || input.nameEn.length > 180 || typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('بيانات الأصل النصية غير صالحة.');
  const groupId = validId(input.groupId, 'مجموعة الأصل');
  if (!database.prepare('SELECT id FROM asset_groups WHERE id = ?').get(groupId)) throw new Error('مجموعة الأصل غير موجودة.');
  if (typeof input.purchaseDate !== 'string' || !isValidDate(input.purchaseDate)) throw new Error('تاريخ شراء الأصل غير صالح.');
  if (typeof input.purchaseValue !== 'string' || typeof input.salvageValue !== 'string') throw new Error('قيم الأصل غير صالحة.');
  const purchaseValue = parseAmount(input.purchaseValue);
  const salvageValue = parseAmount(input.salvageValue);
  if (purchaseValue <= 0n || salvageValue < 0n || salvageValue >= purchaseValue) throw new Error('قيمة الشراء يجب أن تتجاوز القيمة التخريدية، ولا تقبل القيم السالبة.');
  if (!Number.isSafeInteger(input.usefulLifeYears) || Number(input.usefulLifeYears) < 1 || Number(input.usefulLifeYears) > 100) throw new Error('العمر الإنتاجي يجب أن يكون من سنة إلى 100 سنة.');
  if (input.depreciationMethod !== 'straight-line') throw new Error('طريقة الإهلاك المعتمدة حاليًا هي القسط الثابت.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة الأصل غير صالحة.');
  const assetAccountId = validId(input.assetAccountId, 'حساب الأصل');
  const accumulatedDepreciationAccountId = validId(input.accumulatedDepreciationAccountId, 'حساب مجمع الإهلاك');
  const depreciationExpenseAccountId = validId(input.depreciationExpenseAccountId, 'حساب مصروف الإهلاك');
  assertAccount(database, assetAccountId, 'asset', 'حساب الأصل');
  assertAccount(database, accumulatedDepreciationAccountId, 'asset', 'حساب مجمع الإهلاك');
  assertAccount(database, depreciationExpenseAccountId, 'expense', 'حساب مصروف الإهلاك');
  if (new Set([assetAccountId, accumulatedDepreciationAccountId, depreciationExpenseAccountId]).size !== 3) throw new Error('يجب اختيار حساب مستقل لكل غرض محاسبي.');
  return { ...(id === undefined ? {} : { id }), code: input.code.trim(), name: input.name.trim(), nameEn: input.nameEn.trim(), groupId,
    purchaseDate: input.purchaseDate, purchaseValue: normalizeAmount(input.purchaseValue), salvageValue: normalizeAmount(input.salvageValue),
    usefulLifeYears: Number(input.usefulLifeYears), depreciationMethod: 'straight-line', assetAccountId,
    accumulatedDepreciationAccountId, depreciationExpenseAccountId, status: input.status, notes: input.notes.trim() };
}

function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try { const result = operation(); database.exec('COMMIT'); return result; }
  catch (error) { database.exec('ROLLBACK'); throw error; }
}

function dayNumber(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function addYears(date: string, years: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const targetDay = Math.min(day, new Date(Date.UTC(year + years, month, 0)).getUTCDate());
  return `${String(year + years).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

function cumulativeDepreciation(asset: Asset, throughDate: string): bigint {
  if (throughDate < asset.purchaseDate) return 0n;
  const cost = parseAmount(asset.purchaseValue) - parseAmount(asset.salvageValue);
  const endDate = addYears(asset.purchaseDate, asset.usefulLifeYears);
  const totalDays = BigInt(dayNumber(endDate) - dayNumber(asset.purchaseDate));
  const usedDays = BigInt(Math.min(dayNumber(throughDate) - dayNumber(asset.purchaseDate) + 1, Number(totalDays)));
  if (totalDays <= 0n || usedDays <= 0n) return 0n;
  return (cost * usedDays * 2n + totalDays) / (2n * totalDays);
}

function depreciationAmount(asset: Asset, from: string, to: string): bigint {
  const [year, month, day] = from.split('-').map(Number);
  const priorDate = new Date(Date.UTC(year, month - 1, day));
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  const prior = `${String(priorDate.getUTCFullYear()).padStart(4, '0')}-${String(priorDate.getUTCMonth() + 1).padStart(2, '0')}-${String(priorDate.getUTCDate()).padStart(2, '0')}`;
  return cumulativeDepreciation(asset, to) - cumulativeDepreciation(asset, prior);
}

function readRun(database: DatabaseSync, runId: number): AssetDepreciationRun {
  const row = database.prepare(`SELECT runs.*, COUNT(lines.asset_id) AS asset_count, journal_entries.created_at AS posted_at
    FROM asset_depreciation_runs runs JOIN journal_entries ON journal_entries.id = runs.journal_entry_id
    JOIN asset_depreciation_lines lines ON lines.run_id = runs.id WHERE runs.id = ? GROUP BY runs.id`).get(runId) as Row | undefined;
  if (!row) throw new Error('عملية الترحيل المطلوبة غير موجودة.');
  const lines = (database.prepare(`SELECT assets.id AS asset_id, assets.code AS asset_code, assets.name AS asset_name,
    assets.group_id, groups.code AS group_code, groups.name AS group_name, assets.purchase_value, assets.salvage_value, lines.amount
    FROM asset_depreciation_lines lines JOIN fixed_assets assets ON assets.id = lines.asset_id
    JOIN asset_groups groups ON groups.id = assets.group_id WHERE lines.run_id = ? ORDER BY assets.code`).all(runId) as Row[])
    .map((line) => ({ assetId: Number(line.asset_id), assetCode: String(line.asset_code), assetName: String(line.asset_name),
      groupId: Number(line.group_id), groupCode: String(line.group_code), groupName: String(line.group_name),
      purchaseValue: String(line.purchase_value), salvageValue: String(line.salvage_value), amount: String(line.amount), posted: true }));
  return { id: Number(row.id), number: String(row.number), from: String(row.starts_on), to: String(row.ends_on),
    assetCount: Number(row.asset_count), total: formatAmount(lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n)),
    journalEntryId: Number(row.journal_entry_id), postedAt: String(row.posted_at), lines };
}

export function registerAssetHandlers(getDatabase: () => DatabaseSync): void {
  ipcMain.handle('assets:groups:list', (_event, searchValue: unknown) => {
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const search = String(searchValue ?? '').trim();
    if (search.length > 100) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    return groupRows(getDatabase(), search);
  });
  ipcMain.handle('assets:groups:save', (_event, value: unknown) => {
    const database = getDatabase();
    const group = validateGroup(database, value);
    if (group.id) {
      const result = database.prepare(`UPDATE asset_groups SET code = ?, name = ?, name_en = ?, asset_account_id = ?,
        accumulated_depreciation_account_id = ?, depreciation_expense_account_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(group.code, group.name, group.nameEn, group.assetAccountId, group.accumulatedDepreciationAccountId,
          group.depreciationExpenseAccountId, group.notes, group.id);
      if (!result.changes) throw new Error('مجموعة الأصول المطلوبة غير موجودة.');
      return groupRows(database).find((entry) => entry.id === group.id)!;
    }
    const result = database.prepare(`INSERT INTO asset_groups (code, name, name_en, asset_account_id, accumulated_depreciation_account_id,
      depreciation_expense_account_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(group.code, group.name, group.nameEn,
      group.assetAccountId, group.accumulatedDepreciationAccountId, group.depreciationExpenseAccountId, group.notes);
    return groupRows(database).find((entry) => entry.id === Number(result.lastInsertRowid))!;
  });
  ipcMain.handle('assets:groups:delete', (_event, idValue: unknown) => {
    const database = getDatabase();
    const id = validId(idValue, 'رقم المجموعة');
    const result = database.prepare('DELETE FROM asset_groups WHERE id = ?').run(id);
    if (!result.changes) throw new Error('مجموعة الأصول المطلوبة غير موجودة.');
    return true;
  });
  ipcMain.handle('assets:list', (_event, searchValue: unknown) => {
    if (searchValue !== undefined && typeof searchValue !== 'string') throw new Error('عبارة البحث غير صالحة.');
    const search = String(searchValue ?? '').trim();
    if (search.length > 100) throw new Error('عبارة البحث طويلة أكثر من اللازم.');
    return assetRows(getDatabase(), search);
  });
  ipcMain.handle('assets:save', (_event, value: unknown) => {
    const database = getDatabase();
    const asset = validateAsset(database, value);
    if (asset.id && database.prepare('SELECT 1 FROM asset_depreciation_lines WHERE asset_id = ? LIMIT 1').get(asset.id)) {
      throw new Error('لا يمكن تعديل بيانات أصل سبق ترحيل إهلاكه؛ احتفظ بالسجل التاريخي أو استخدم آلية العكس المعتمدة.');
    }
    if (asset.id) {
      const result = database.prepare(`UPDATE fixed_assets SET code = ?, name = ?, name_en = ?, group_id = ?, purchase_date = ?,
        purchase_value = ?, salvage_value = ?, useful_life_years = ?, depreciation_method = ?, asset_account_id = ?,
        accumulated_depreciation_account_id = ?, depreciation_expense_account_id = ?, status = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?`).run(asset.code, asset.name, asset.nameEn, asset.groupId, asset.purchaseDate, asset.purchaseValue,
        asset.salvageValue, asset.usefulLifeYears, asset.depreciationMethod, asset.assetAccountId,
        asset.accumulatedDepreciationAccountId, asset.depreciationExpenseAccountId, asset.status, asset.notes, asset.id);
      if (!result.changes) throw new Error('الأصل المطلوب غير موجود.');
      return assetRows(database).find((entry) => entry.id === asset.id)!;
    }
    const result = database.prepare(`INSERT INTO fixed_assets (code, name, name_en, group_id, purchase_date, purchase_value, salvage_value,
      useful_life_years, depreciation_method, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id,
      status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(asset.code, asset.name, asset.nameEn, asset.groupId,
      asset.purchaseDate, asset.purchaseValue, asset.salvageValue, asset.usefulLifeYears, asset.depreciationMethod,
      asset.assetAccountId, asset.accumulatedDepreciationAccountId, asset.depreciationExpenseAccountId, asset.status, asset.notes);
    return assetRows(database).find((entry) => entry.id === Number(result.lastInsertRowid))!;
  });
  ipcMain.handle('assets:delete', (_event, idValue: unknown) => {
    const database = getDatabase();
    const id = validId(idValue, 'رقم الأصل');
    if (database.prepare('SELECT 1 FROM asset_depreciation_lines WHERE asset_id = ? LIMIT 1').get(id)) throw new Error('لا يمكن حذف أصل له إهلاك مرحّل.');
    const result = database.prepare('DELETE FROM fixed_assets WHERE id = ?').run(id);
    if (!result.changes) throw new Error('الأصل المطلوب غير موجود.');
    return true;
  });
  ipcMain.handle('assets:depreciation:get', (_event, value: unknown): AssetDepreciationReport => {
    const range = validateRange(value);
    const database = getDatabase();
    const assets = assetRows(database).filter((asset) => asset.status === 'active' && asset.purchaseDate <= range.to);
    const lines: AssetDepreciationLine[] = assets.map((asset) => {
      const amount = depreciationAmount(asset, range.from, range.to);
      const posted = Boolean(database.prepare(`SELECT 1 FROM asset_depreciation_lines lines JOIN asset_depreciation_runs runs ON runs.id = lines.run_id
        WHERE lines.asset_id = ? AND runs.starts_on <= ? AND runs.ends_on >= ? LIMIT 1`).get(asset.id, range.to, range.from));
      return { assetId: asset.id, assetCode: asset.code, assetName: asset.name, groupId: asset.groupId,
        groupCode: asset.groupCode, groupName: asset.groupName, purchaseValue: asset.purchaseValue, salvageValue: asset.salvageValue,
        amount: formatAmount(amount), posted };
    }).filter((line) => parseAmount(line.amount) > 0n);
    const runs = (database.prepare('SELECT id FROM asset_depreciation_runs ORDER BY starts_on DESC, id DESC').all() as Row[])
      .map((row) => readRun(database, Number(row.id)));
    const postedTotal = runs.filter((run) => run.from === range.from && run.to === range.to)
      .reduce((sum, run) => sum + parseAmount(run.total), 0n);
    return { from: range.from, to: range.to, lines, runs, total: formatAmount(lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n)),
      postedTotal: formatAmount(postedTotal), dueCount: lines.filter((line) => !line.posted).length };
  });
  ipcMain.handle('assets:depreciation:post', (_event, value: unknown): AssetDepreciationRun => {
    const range = validateRange(value);
    const database = getDatabase();
    return withTransaction(database, () => {
      if (database.prepare('SELECT id FROM asset_depreciation_runs WHERE starts_on = ? AND ends_on = ?').get(range.from, range.to)) {
        throw new Error('تم ترحيل هذه الفترة من قبل.');
      }
      const assets = assetRows(database).filter((asset) => asset.status === 'active' && asset.purchaseDate <= range.to);
      const lines = assets.map((asset) => ({ asset, amount: depreciationAmount(asset, range.from, range.to) }))
        .filter((line) => line.amount > 0n);
      if (!lines.length) throw new Error('لا توجد أصول مستحقة للإهلاك في الفترة المحددة.');
      for (const { asset } of lines) {
        if (database.prepare(`SELECT 1 FROM asset_depreciation_lines lines JOIN asset_depreciation_runs runs ON runs.id = lines.run_id
          WHERE lines.asset_id = ? AND runs.starts_on <= ? AND runs.ends_on >= ? LIMIT 1`).get(asset.id, range.to, range.from)) {
          throw new Error(`يوجد إهلاك مرحّل متداخل للفترة على الأصل ${asset.code}.`);
        }
      }
      const total = lines.reduce((sum, line) => sum + line.amount, 0n);
      const entryResult = database.prepare(`INSERT INTO journal_entries (reference, entry_date, description, request_key)
        VALUES (?, ?, ?, ?)`).run(`DEP-${range.from}-${range.to}`, range.to, `إهلاك الأصول للفترة ${range.from} إلى ${range.to}`, `asset-depreciation:${randomUUID()}`);
      const entryId = Number(entryResult.lastInsertRowid);
      const accountTotals = new Map<string, { expense: number; accumulated: number; amount: bigint }>();
      for (const { asset, amount } of lines) {
        const key = `${asset.depreciationExpenseAccountId}:${asset.accumulatedDepreciationAccountId}`;
        const current = accountTotals.get(key) ?? { expense: asset.depreciationExpenseAccountId, accumulated: asset.accumulatedDepreciationAccountId, amount: 0n };
        current.amount += amount;
        accountTotals.set(key, current);
      }
      const insertJournalLine = database.prepare(`INSERT INTO journal_lines (entry_id, line_order, account_id, debit, credit, description)
        VALUES (?, ?, ?, ?, ?, ?)`);
      let order = 1;
      let debit = 0n;
      let credit = 0n;
      for (const entry of accountTotals.values()) {
        const amount = formatAmount(entry.amount);
        insertJournalLine.run(entryId, order++, entry.expense, amount, '0', 'مصروف إهلاك الأصول');
        insertJournalLine.run(entryId, order++, entry.accumulated, '0', amount, 'مجمع إهلاك الأصول');
        debit += entry.amount;
        credit += entry.amount;
      }
      if (debit === 0n || debit !== credit) throw new Error('تعذر إنشاء قيد إهلاك متوازن.');
      const nextNumber = Number((database.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM asset_depreciation_runs').get() as Row).next);
      const number = `DEP-${range.to.slice(0, 7).replace('-', '')}-${String(nextNumber).padStart(5, '0')}`;
      const runResult = database.prepare(`INSERT INTO asset_depreciation_runs (number, starts_on, ends_on, journal_entry_id) VALUES (?, ?, ?, ?)`)
        .run(number, range.from, range.to, entryId);
      const runId = Number(runResult.lastInsertRowid);
      const insertAssetLine = database.prepare('INSERT INTO asset_depreciation_lines (run_id, asset_id, amount) VALUES (?, ?, ?)');
      for (const { asset, amount } of lines) insertAssetLine.run(runId, asset.id, formatAmount(amount));
      return readRun(database, runId);
    });
  });
}