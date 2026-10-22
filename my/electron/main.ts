import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { DatabaseSync, backup as backupDatabase, type SQLOutputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { installAccountingSchema, registerAccountingHandlers } from './accounting.js';
import { installAssetSchema, registerAssetHandlers } from './assets.js';
import { readDashboardSummary } from './dashboard.js';
import { installSalesSchema, registerSalesHandlers } from './sales.js';
import { installSalesMasterSchema, registerSalesMasterHandlers } from './sales-masters.js';
import { installSalesReturnSchema, registerSalesReturnHandlers } from './sales-returns.js';
import { registerSalesDashboardHandlers } from './sales-dashboard.js';
import { installPurchaseSchema, registerPurchaseHandlers } from './purchases.js';
import { installInventorySchema, registerInventoryHandlers } from './inventory.js';
import { installInventoryDocumentSchema, registerInventoryDocumentHandlers } from './inventory-documents.js';
import { installTreasurySchema, registerTreasuryHandlers } from './treasury.js';
import { registerPortfolioDashboardHandlers } from './portfolio-dashboard.js';
import { registerReportHandlers } from './reports.js';
import { installProjectsSchema, registerProjectHandlers } from './projects.js';
import { installPropertySalesSchema, registerPropertySalesHandlers } from './property-sales.js';
import { installContractorSchema, registerContractorHandlers } from './contractors.js';
import { installFinancialDocumentSchema, registerFinancialDocumentHandlers } from './financial-documents.js';
import {
  authenticateUser, changeLegacyAdminPassword, currentUser, hasPermission, initialSetupRequired,
  initializeSystemAdmin, installUserSchema, registerUserHandlers,
} from './users.js';
import { MODULES, RECORD_STATUSES, isModuleKey } from '../src/shared/modules.js';
import type { BackupPreferences, BackupRecord, BackupState, CompanyProfile, ModuleKey, RecordInput, RecordItem, RecordStats, RestoreCandidate } from '../src/shared/types.js';

function handleOutputPipeErrors(): void {
  const handleError = (error: Error): void => {
    if ((error as NodeJS.ErrnoException).code !== 'EPIPE') throw error;
  };
  process.stdout.on('error', handleError);
  process.stderr.on('error', handleError);
}

handleOutputPipeErrors();

const testUserData = process.env.ELSAAD_TEST_USER_DATA?.trim();
if (testUserData) app.setPath('userData', testUserData);
const cdpPort = process.env.ELSAAD_CDP_PORT?.trim();
if (cdpPort && /^\d{1,5}$/.test(cdpPort) && Number(cdpPort) > 0 && Number(cdpPort) <= 65535) {
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  let database: DatabaseSync | undefined;
  let databasePath = '';
  let authenticatedUserId = 0;
  let mainWindow: BrowserWindow | undefined;
  let restoreFilePath = '';
  let automaticBackupTimer: NodeJS.Timeout | undefined;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  function requireAuthentication(): DatabaseSync {
    if (!authenticatedUserId) throw new Error('يرجى تسجيل الدخول أولًا.');
    if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
    return database;
  }

  function isValidDate(value: string): boolean {
    if (!value) return true;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function validateRecord(value: unknown): RecordInput & { id?: number } {
    if (!value || typeof value !== 'object') throw new Error('بيانات السجل غير صالحة.');
    const input = value as Partial<RecordInput> & { id?: unknown };
    if (!isModuleKey(input.module)) throw new Error('القسم المحدد غير صالح.');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 180) {
      throw new Error('أدخل اسمًا لا يتجاوز 180 حرفًا.');
    }
    const optionalFields = ['reference', 'party', 'date', 'amount', 'status', 'notes'] as const;
    for (const field of optionalFields) {
      if (typeof input[field] !== 'string') throw new Error('أحد الحقول غير صالح.');
    }
    if (input.reference!.length > 80 || input.party!.length > 180 || input.date!.length > 10
      || input.amount!.length > 40 || input.notes!.length > 2000) {
      throw new Error('تجاوز أحد الحقول الحد المسموح.');
    }
    if (!isValidDate(input.date!)) throw new Error('صيغة التاريخ غير صالحة.');
    if (!RECORD_STATUSES.some((status) => status.value === input.status)) {
      throw new Error('حالة السجل غير صالحة.');
    }
    if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) {
      throw new Error('رقم السجل غير صالح.');
    }
    return {
      id: input.id as number | undefined,
      module: input.module,
      title: input.title.trim(),
      reference: input.reference!,
      party: input.party!,
      date: input.date!,
      amount: input.amount!,
      status: input.status!,
      notes: input.notes!,
    };
  }

  function asRecord(row: Record<string, SQLOutputValue>): RecordItem {
    return {
      id: Number(row.id),
      module: String(row.module) as ModuleKey,
      title: String(row.title),
      reference: String(row.reference),
      party: String(row.party),
      date: String(row.date),
      amount: String(row.amount),
      status: String(row.status),
      notes: String(row.notes),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  function installDatabaseSchema(db: DatabaseSync): void {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        module TEXT NOT NULL,
        title TEXT NOT NULL,
        reference TEXT NOT NULL DEFAULT '',
        party TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        amount TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS records_module_updated ON records(module, updated_at DESC);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backup_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        size_bytes INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL CHECK (kind IN ('automatic', 'manual', 'pre-restore', 'restore')),
        status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
        message TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS backup_history_created ON backup_history(created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS data_reset_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        backup_file_name TEXT NOT NULL,
        deleted_rows TEXT NOT NULL
      );
    `);
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('theme', 'light')").run();
    installAccountingSchema(db);
    installAssetSchema(db);
    installSalesSchema(db);
    installSalesMasterSchema(db);
    installSalesReturnSchema(db);
    installInventorySchema(db);
    installPurchaseSchema(db);
    installProjectsSchema(db);
    installInventoryDocumentSchema(db);
    installTreasurySchema(db);
    installFinancialDocumentSchema(db);
    installPropertySalesSchema(db);
    installContractorSchema(db);
    installUserSchema(db);
  }

  function installDatabase(): void {
    databasePath = join(app.getPath('userData'), 'elsaad-erp.sqlite');
    database = new DatabaseSync(databasePath);
    installDatabaseSchema(database);
  }

  function getSetting(db: DatabaseSync, key: string, fallback = ''): string {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Record<string, SQLOutputValue> | undefined;
    return row?.value === undefined ? fallback : String(row.value);
  }

  function setSetting(db: DatabaseSync, key: string, value: string): void {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  function readCompanyProfile(db: DatabaseSync): CompanyProfile {
    let logoDataUrl = '';
    let logoPath = getSetting(db, 'company_logo_file');
    const encoded = getSetting(db, 'company_logo_base64');
    if (logoPath || encoded) {
      if (basename(logoPath) !== logoPath || !/^[\w-]+\.(png|jpg|webp)$/i.test(logoPath)) {
        if (logoPath) throw new Error('مسار شعار الشركة المخزن غير صالح؛ أعد رفع الشعار.');
      }
      const extension = logoPath ? extname(logoPath).toLowerCase() : getSetting(db, 'company_logo_extension');
      if (!['.png', '.jpg', '.webp'].includes(extension)) throw new Error('صيغة شعار الشركة المخزنة غير صالحة؛ أعد رفع الشعار.');
      const filePath = logoPath ? join(app.getPath('userData'), 'company', logoPath) : '';
      const currentBytes = filePath && existsSync(filePath) ? readFileSync(filePath) : null;
      let bytes = currentBytes;
      if (encoded) {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
          throw new Error('بيانات شعار الشركة المخزنة غير صالحة؛ أعد رفع الشعار.');
        }
        bytes = Buffer.from(encoded, 'base64');
      } else if (bytes) {
        setSetting(db, 'company_logo_base64', bytes.toString('base64'));
        setSetting(db, 'company_logo_extension', extension);
      } else {
        throw new Error('ملف شعار الشركة غير موجود؛ أعد رفع الشعار.');
      }
      if (!bytes || bytes.length > 5 * 1024 * 1024 || !isValidImage(bytes, extension)) {
        throw new Error('ملف شعار الشركة تالف أو غير متوافق؛ أعد رفع الشعار.');
      }
      if (!currentBytes || !currentBytes.equals(bytes)) {
        const directory = join(app.getPath('userData'), 'company');
        mkdirSync(directory, { recursive: true });
        const nextName = `company-logo-${randomUUID()}${extension}`;
        const nextPath = join(directory, nextName);
        const temporaryPath = `${nextPath}.partial`;
        try {
          writeFileSync(temporaryPath, bytes, { flag: 'wx' });
          renameSync(temporaryPath, nextPath);
          setSetting(db, 'company_logo_file', nextName);
        } catch (error) {
          rmSync(temporaryPath, { force: true });
          rmSync(nextPath, { force: true });
          throw new Error(`تعذر استعادة ملف شعار الشركة من النسخة المحلية: ${error instanceof Error ? error.message : 'خطأ في الملف.'}`);
        }
        const previousPath = logoPath ? join(directory, logoPath) : '';
        logoPath = nextName;
        try { if (previousPath && existsSync(previousPath)) rmSync(previousPath, { force: true }); }
        catch (error) { console.error('Unable to remove replaced company logo after restore:', error); }
      }
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      logoDataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    }
    return {
      nameAr: getSetting(db, 'company_name', getSetting(db, 'companyName', getSetting(db, 'company'))), nameEn: getSetting(db, 'company_name_en'),
      addressAr: getSetting(db, 'company_address_ar'), addressEn: getSetting(db, 'company_address_en'),
      email: getSetting(db, 'company_email'), phone: getSetting(db, 'company_phone'),
      commercialRegister: getSetting(db, 'company_commercial_register'), taxNumber: getSetting(db, 'company_tax_number'),
      logoDataUrl,
    };
  }

  function validateCompanyProfile(value: unknown): Omit<CompanyProfile, 'logoDataUrl'> {
    if (!value || typeof value !== 'object') throw new Error('بيانات الشركة غير صالحة.');
    const input = value as Partial<Record<keyof CompanyProfile, unknown>>;
    const limits = { nameAr: 180, nameEn: 180, addressAr: 500, addressEn: 500, email: 180, phone: 60, commercialRegister: 100, taxNumber: 100 };
    const profile: Omit<CompanyProfile, 'logoDataUrl'> = {
      nameAr: '', nameEn: '', addressAr: '', addressEn: '', email: '', phone: '', commercialRegister: '', taxNumber: '',
    };
    for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
      const fieldValue = input[field];
      if (typeof fieldValue !== 'string' || fieldValue.length > limits[field]) throw new Error(`قيمة حقل ${field} غير صالحة أو تجاوزت الحد المسموح.`);
      profile[field] = fieldValue.trim();
    }
    if (!profile.nameAr) throw new Error('أدخل اسم الشركة بالعربية.');
    if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw new Error('صيغة البريد الإلكتروني غير صالحة.');
    return profile;
  }

  function requiredBackupTables(db: DatabaseSync): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<Record<string, SQLOutputValue>>)
      .map((row) => String(row.name));
  }

  function validateBackupFile(filePath: string, expectedTables = database ? requiredBackupTables(database) : []): { size: number; modifiedAt: string } {
    if (!existsSync(filePath)) throw new Error('ملف النسخة المحدد غير موجود.');
    const file = statSync(filePath);
    if (!file.isFile() || file.size < 512) throw new Error('ملف النسخة فارغ أو غير مكتمل.');
    if (existsSync(`${filePath}-wal`) && statSync(`${filePath}-wal`).size > 0) {
      throw new Error('ملف النسخة يعتمد على سجل WAL خارجي؛ اختر نسخة SQLite مستقلة مكتملة.');
    }
    let candidate: DatabaseSync | undefined;
    try {
      candidate = new DatabaseSync(filePath, { readOnly: true });
      const check = candidate.prepare('PRAGMA integrity_check').get() as Record<string, SQLOutputValue> | undefined;
      if (String(check?.integrity_check ?? '') !== 'ok') throw new Error('فشل فحص سلامة قاعدة بيانات النسخة.');
      const tables = new Set((candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<Record<string, SQLOutputValue>>)
        .map((row) => String(row.name)));
      const required = ['records', 'app_settings', 'accounts', 'journal_entries', 'sales_documents', 'property_contracts', 'property_installments', 'inventory_items'];
      if ([...new Set([...required, ...expectedTables])].some((name) => !tables.has(name))) {
        throw new Error('النسخة غير مكتملة أو غير متوافقة مع هذا الإصدار من البرنامج.');
      }
      return { size: file.size, modifiedAt: file.mtime.toISOString() };
    } catch (error) {
      if (error instanceof Error && (error.message.includes('غير مكتملة') || error.message.includes('سلامة') || error.message.includes('فارغ') || error.message.includes('غير موجود'))) throw error;
      throw new Error('الملف المحدد ليس نسخة SQLite صالحة أو أنه تالف.');
    } finally {
      candidate?.close();
    }
  }

  async function resetOperationalData(confirmation: unknown): Promise<{ backupFileName: string; deletedRows: Record<string, number> }> {
    const db = requireAuthentication();
    const user = currentUser(db, authenticatedUserId);
    if (!user.systemAdmin) throw new Error('تتطلب عملية تفريغ البيانات صلاحية مدير النظام.');
    if (confirmation !== 'تفريغ بيانات التشغيل') throw new Error('لم يتم تأكيد عبارة تفريغ البيانات المطلوبة.');
    const backup = await createBackupInternal('manual', false);
    const backupFileName = backup.history.find((item) => item.status === 'success' && item.kind === 'manual')?.fileName;
    if (!backupFileName) throw new Error('تعذر تحديد ملف نسخة الأمان؛ لم يتم تفريغ البيانات.');

    const deletedRows: Record<string, number> = {};
    const deleteRows = (table: string, sql = `DELETE FROM "${table}"`): void => {
      deletedRows[table] = Number(db.prepare(sql).run().changes);
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      const orderedTables = [
        'property_receipt_allocations', 'property_installment_adjustments', 'property_receipts',
        'property_contract_free_payments', 'property_contract_schedules', 'property_installments', 'property_contracts',
        'expense_allocations', 'financial_vouchers', 'expenses',
        'contractor_certificate_lines', 'contractor_certificate_documents', 'contractor_contract_lines',
        'contractor_vouchers', 'contractor_contracts', 'contractor_opening_entries',
        'sales_return_lines', 'sales_returns', 'sales_inventory_outbox',
        'purchase_return_lines', 'purchase_returns', 'inventory_receipt_lines', 'inventory_receipts',
        'purchase_invoice_lines', 'purchase_invoices',
        'inventory_issue_lines', 'inventory_issues', 'inventory_transfer_lines', 'inventory_transfers',
        'asset_depreciation_lines', 'asset_depreciation_runs', 'budget_lines', 'budgets',
        'journal_lines', 'journal_entries', 'project_imported_records',
      ];
      for (const table of orderedTables) deleteRows(table);
      for (const table of ['sales_document_lines', 'sales_documents', 'inventory_stock_movements']) {
        let remaining = 0;
        do {
          const relation = table === 'sales_document_lines'
            ? '(child.source_document_line_id = item.id OR child.source_work_order_line_id = item.id)'
            : `child.${table === 'sales_documents' ? 'source_document_id' : 'reversal_of_id'} = item.id`;
          const result = db.prepare(`
            DELETE FROM "${table}" AS item
            WHERE NOT EXISTS (
              SELECT 1 FROM "${table}" AS child
              WHERE ${relation}
            )
          `).run();
          deletedRows[table] = (deletedRows[table] ?? 0) + Number(result.changes);
          remaining = Number((db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as Record<string, SQLOutputValue>).count);
          if (remaining && result.changes === 0) throw new Error(`تعذر ترتيب حذف السجلات المترابطة في ${table}.`);
        } while (remaining);
      }
      deleteRows('records', `DELETE FROM records WHERE id NOT IN (
        SELECT legacy_record_id FROM projects WHERE legacy_record_id IS NOT NULL
        UNION SELECT legacy_record_id FROM contractors WHERE legacy_record_id IS NOT NULL
      )`);
      const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyErrors.length) throw new Error('تعذر تفريغ البيانات بسبب روابط مرجعية متبقية.');
      const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, SQLOutputValue>;
      if (String(integrity.integrity_check) !== 'ok') throw new Error('فشل فحص سلامة قاعدة البيانات بعد التفريغ.');
      db.prepare('INSERT INTO data_reset_history (user_id, backup_file_name, deleted_rows) VALUES (?, ?, ?)')
        .run(authenticatedUserId, backupFileName, JSON.stringify(deletedRows));
      db.exec('COMMIT');
      return { backupFileName, deletedRows };
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`أُلغي تفريغ البيانات ولم تُحذف أي سجلات: ${error instanceof Error ? error.message : 'خطأ غير معروف.'}`);
    }
  }

  function saveBackupHistory(kind: BackupRecord['kind'] | 'restore', status: BackupRecord['status'], fileName: string, size: number, message: string): void {
    if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة لتسجيل العملية.');
    database.prepare('INSERT INTO backup_history (file_name, size_bytes, kind, status, message) VALUES (?, ?, ?, ?, ?)')
      .run(fileName, size, kind, status, message);
  }

  function recordRestoreFailure(filePath: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'حدث خطأ غير معروف أثناء الاستعادة.';
    try { saveBackupHistory('restore', 'failed', basename(filePath), 0, message); }
    catch (historyError) { console.error('Failed to record restore error:', historyError); }
  }

  function backupPreferences(db: DatabaseSync): BackupPreferences {
    const defaultDirectory = join(app.getPath('userData'), 'backups');
    const directory = getSetting(db, 'backup_directory', defaultDirectory);
    return {
      directory: isAbsolute(directory) ? resolve(directory) : defaultDirectory,
      automatic: getSetting(db, 'backup_automatic', 'false') === 'true',
      intervalHours: Number(getSetting(db, 'backup_interval_hours', '24')),
      retentionCount: Number(getSetting(db, 'backup_retention_count', '10')),
    };
  }

  function getBackupState(): BackupState {
    const db = requireAuthentication();
    const history = db.prepare('SELECT file_name, created_at, size_bytes, kind, status, message FROM backup_history ORDER BY id DESC LIMIT 100')
      .all() as Array<Record<string, SQLOutputValue>>;
    return {
      preferences: backupPreferences(db),
      history: history.map((row) => ({
        fileName: String(row.file_name), date: String(row.created_at), size: Number(row.size_bytes),
        kind: String(row.kind) as BackupRecord['kind'], status: String(row.status) as BackupRecord['status'], message: String(row.message),
      })),
    };
  }

  function pruneBackupFiles(directory: string, retentionCount: number): void {
    const valid: Array<{ path: string; modifiedAt: number }> = [];
    for (const name of readdirSync(directory)) {
      if (!/^elsaad-backup-[\w-]+\.sqlite$/i.test(name)) continue;
      const filePath = join(directory, name);
      try {
        validateBackupFile(filePath);
        valid.push({ path: filePath, modifiedAt: statSync(filePath).mtimeMs });
      } catch (error) {
        console.warn(`Retaining backup file that could not be validated: ${filePath}`, error);
      }
    }
    valid.sort((left, right) => right.modifiedAt - left.modifiedAt);
    for (const old of valid.slice(retentionCount)) rmSync(old.path);
  }

  async function createBackupInternal(kind: 'automatic' | 'manual' | 'pre-restore', applyRetention = true): Promise<BackupState> {
    const db = database;
    if (!db) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
    const directory = backupPreferences(db).directory;
    let tempPath = '';
    let finalPath = '';
    try {
      mkdirSync(directory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `elsaad-backup-${stamp}-${randomUUID().slice(0, 8)}.sqlite`;
      finalPath = join(directory, fileName);
      tempPath = join(directory, `.${fileName}.partial`);
      await backupDatabase(db, tempPath);
      const snapshot = new DatabaseSync(tempPath);
      try {
        const mode = snapshot.prepare('PRAGMA journal_mode = DELETE').get() as Record<string, SQLOutputValue> | undefined;
        if (String(mode?.journal_mode ?? '').toLowerCase() !== 'delete') throw new Error('تعذر تجهيز ملف نسخة مستقل عن WAL.');
      } finally {
        snapshot.close();
      }

      rmSync(`${tempPath}-wal`, { force: true });
      rmSync(`${tempPath}-shm`, { force: true });
      validateBackupFile(tempPath);
      renameSync(tempPath, finalPath);
      const size = statSync(finalPath).size;
      saveBackupHistory(kind, 'success', fileName, size, '');
      if (applyRetention) {
        try {
          pruneBackupFiles(directory, backupPreferences(db).retentionCount);
        } catch (error) {
          const message = `تعذر تطبيق سياسة الاحتفاظ: ${error instanceof Error ? error.message : 'خطأ في الملفات.'}`;
          db.prepare('UPDATE backup_history SET message = ? WHERE id = (SELECT MAX(id) FROM backup_history)').run(message);
        }
      }
      return getBackupState();
    } catch (error) {
      if (tempPath && existsSync(tempPath)) rmSync(tempPath, { force: true });
      if (finalPath && existsSync(finalPath)) rmSync(finalPath, { force: true });
      const message = error instanceof Error ? error.message : 'حدث خطأ غير معروف أثناء إنشاء النسخة.';
      try { saveBackupHistory(kind, 'failed', basename(finalPath), 0, message); }
      catch (historyError) { console.error('Failed to record backup error:', historyError); }
      throw new Error(`تعذر إنشاء النسخة الاحتياطية: ${message}`);
    }
  }

  function scheduleAutomaticBackup(): void {
    if (automaticBackupTimer) clearInterval(automaticBackupTimer);
    automaticBackupTimer = undefined;
    if (!database) return;
    const preferences = backupPreferences(database);
    if (!preferences.automatic) return;
    automaticBackupTimer = setInterval(() => {
      void createBackupInternal('automatic').catch((error: unknown) => console.error('Automatic backup failed:', error));
    }, preferences.intervalHours * 60 * 60 * 1000);
    automaticBackupTimer.unref();
  }

  function validateBackupPreferences(value: unknown): Omit<BackupPreferences, 'directory'> {
    if (!value || typeof value !== 'object') throw new Error('إعدادات النسخ الاحتياطي غير صالحة.');
    const input = value as Partial<Omit<BackupPreferences, 'directory'>>;
    if (typeof input.automatic !== 'boolean') throw new Error('اختيار النسخ التلقائي غير صالح.');
    if (!Number.isSafeInteger(input.intervalHours) || Number(input.intervalHours) < 1 || Number(input.intervalHours) > 720) {
      throw new Error('فترة النسخ يجب أن تكون بين ساعة و720 ساعة.');
    }
    if (!Number.isSafeInteger(input.retentionCount) || Number(input.retentionCount) < 1 || Number(input.retentionCount) > 100) {
      throw new Error('عدد النسخ المحتفظ بها يجب أن يكون بين 1 و100.');
    }
    return { automatic: input.automatic, intervalHours: Number(input.intervalHours), retentionCount: Number(input.retentionCount) };
  }

  function setBackupPreferences(value: unknown): BackupState {
    const db = requireAuthentication();
    const preferences = validateBackupPreferences(value);
    setSetting(db, 'backup_automatic', String(preferences.automatic));
    setSetting(db, 'backup_interval_hours', String(preferences.intervalHours));
    setSetting(db, 'backup_retention_count', String(preferences.retentionCount));
    scheduleAutomaticBackup();
    return getBackupState();
  }

  function isValidImage(bytes: Buffer, extension: string): boolean {
    if (extension === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (extension === '.jpg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    return extension === '.webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }

  function uploadCompanyLogo(): CompanyProfile | null {
    const db = requireAuthentication();
    const owner = mainWindow;
    if (!owner) throw new Error('تعذر تحديد نافذة التطبيق.');
    const testLogo = testUserData ? process.env.ELSAAD_TEST_LOGO_FILE?.trim() : '';
    const selected = testLogo && existsSync(testLogo) ? [testLogo] : dialog.showOpenDialogSync(owner, {
      title: 'اختيار شعار الشركة', properties: ['openFile'],
      filters: [{ name: 'صور PNG أو JPEG أو WebP', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!selected?.[0]) return null;
    const source = selected[0];
    const sourceExtension = extname(source).toLowerCase();
    const extension = sourceExtension === '.jpeg' ? '.jpg' : sourceExtension;
    if (!['.png', '.jpg', '.webp'].includes(extension)) throw new Error('نوع الشعار غير مدعوم. اختر PNG أو JPEG أو WebP.');
    const info = statSync(source);
    if (!info.isFile() || info.size <= 0 || info.size > 5 * 1024 * 1024) throw new Error('حجم الشعار يجب أن يكون أكبر من صفر وألا يتجاوز 5 ميجابايت.');
    const bytes = readFileSync(source);
    if (!isValidImage(bytes, extension)) throw new Error('محتوى الملف لا يطابق صيغة الصورة المحددة أو أن الصورة تالفة.');
    const logoDirectory = join(app.getPath('userData'), 'company');
    mkdirSync(logoDirectory, { recursive: true });
    const fileName = `company-logo-${randomUUID()}${extension}`;
    const destination = join(logoDirectory, fileName);
    const temporary = `${destination}.partial`;
    const previous = getSetting(db, 'company_logo_file');
    try {
      copyFileSync(source, temporary);
      renameSync(temporary, destination);
      db.exec('BEGIN IMMEDIATE');
      try {
        setSetting(db, 'company_logo_file', fileName);
        setSetting(db, 'company_logo_base64', bytes.toString('base64'));
        setSetting(db, 'company_logo_extension', extension);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      rmSync(temporary, { force: true });
      rmSync(destination, { force: true });
      throw new Error(`تعذر حفظ الشعار الجديد، وتم الإبقاء على الشعار السابق: ${error instanceof Error ? error.message : 'خطأ في الملف.'}`);
    }
    if (previous && basename(previous) === previous && previous !== fileName) {
      const previousPath = join(logoDirectory, previous);
      try { if (existsSync(previousPath)) rmSync(previousPath, { force: true }); }
      catch (error) { console.error('Unable to remove previous company logo:', error); }
    }
    return readCompanyProfile(db);
  }

  async function chooseRestoreBackup(): Promise<RestoreCandidate | null> {
    requireAuthentication();
    if (!mainWindow) throw new Error('تعذر تحديد نافذة التطبيق.');
    restoreFilePath = '';
    const testDirectory = testUserData ? process.env.ELSAAD_TEST_RESTORE_DIRECTORY?.trim() : '';
    if (testDirectory) {
      const candidateName = readdirSync(testDirectory)
        .filter((name) => /^elsaad-backup-[\w-]+\.sqlite$/i.test(name))
        .sort((left, right) => statSync(join(testDirectory, right)).mtimeMs - statSync(join(testDirectory, left)).mtimeMs)[0];
      if (!candidateName) throw new Error('لا توجد نسخة اختبار صالحة للاختيار.');
      const selectedPath = join(testDirectory, candidateName);
      const file = validateBackupFile(selectedPath);
      restoreFilePath = selectedPath;
      return { fileName: candidateName, size: file.size, createdAt: file.modifiedAt };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختيار نسخة لاستعادتها',
      properties: ['openFile'],
      filters: [{ name: 'نسخ Elsaad SQLite', extensions: ['sqlite', 'db'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selectedPath = result.filePaths[0];
    const file = validateBackupFile(selectedPath);
    restoreFilePath = selectedPath;
    return { fileName: basename(selectedPath), size: file.size, createdAt: file.modifiedAt };
  }

  async function restoreBackup(): Promise<BackupState> {
    requireAuthentication();
    if (!restoreFilePath) throw new Error('اختر ملف نسخة صالحًا قبل تنفيذ الاستعادة.');
    const selectedPath = restoreFilePath;
    const tables = database ? requiredBackupTables(database) : [];
    let selectedFile: { size: number; modifiedAt: string };
    try {
      selectedFile = validateBackupFile(selectedPath, tables);
    } catch (error) {
      restoreFilePath = '';
      recordRestoreFailure(selectedPath, error);
      throw error;
    }
    let safety: BackupState;
    try { safety = await createBackupInternal('pre-restore', false); }
    catch (error) {
      restoreFilePath = '';
      recordRestoreFailure(selectedPath, error);
      throw error;
    }
    const safetyRecord = safety.history.find((record) => record.kind === 'pre-restore' && record.status === 'success');
    if (!safetyRecord) throw new Error('تعذر إنشاء نسخة أمان؛ أُلغيت الاستعادة ولم تتغير قاعدة البيانات.');

    const stagingPath = `${databasePath}.restore-${randomUUID()}`;
    const displacedPath = `${databasePath}.pre-restore-${randomUUID()}`;
    let originalMoved = false;
    let candidatePlaced = false;
    try {
      copyFileSync(selectedPath, stagingPath);
      validateBackupFile(stagingPath, tables);
      const db = requireAuthentication();
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
      database = undefined;
      rmSync(`${databasePath}-wal`, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
      renameSync(databasePath, displacedPath);
      originalMoved = true;
      renameSync(stagingPath, databasePath);
      candidatePlaced = true;
      database = new DatabaseSync(databasePath);
      installDatabaseSchema(database);
      validateBackupFile(databasePath, tables);
      readCompanyProfile(database);
      saveBackupHistory('pre-restore', 'success', safetyRecord.fileName, safetyRecord.size, 'نسخة أمان أُنشئت قبل الاستعادة.');
      saveBackupHistory('restore', 'success', basename(selectedPath), selectedFile.size, `اكتملت الاستعادة. نسخة الأمان: ${safetyRecord.fileName}`);
      const restoredState = getBackupState();
      rmSync(displacedPath, { force: true });
      restoreFilePath = '';
      return restoredState;
    } catch (error) {
      if (database) {
        try { database.close(); } catch (closeError) { console.error('Failed to close database after restore error:', closeError); }
        database = undefined;
      }
      if (candidatePlaced && existsSync(databasePath)) rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
      if (originalMoved && existsSync(displacedPath)) renameSync(displacedPath, databasePath);
      database = new DatabaseSync(databasePath);
      installDatabaseSchema(database);
      const message = error instanceof Error ? error.message : 'حدث خطأ غير معروف أثناء الاستعادة.';
      restoreFilePath = '';
      saveBackupHistory('restore', 'failed', basename(selectedPath), 0, message);
      throw new Error(`فشلت الاستعادة وتمت إعادة قاعدة البيانات السابقة: ${message}`);
    } finally {
      rmSync(stagingPath, { force: true });
    }
  }

  function installHandlers(): void {
    installIpcAuthorization();
    ipcMain.handle('auth:initial-setup-required', () => {
      if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
      return initialSetupRequired(database);
    });
    ipcMain.handle('auth:initial-setup', (_event, value: unknown) => {
      if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
      const userId = initializeSystemAdmin(database, value);
      authenticatedUserId = userId;
      return { ok: true, message: '', userId };
    });
    ipcMain.handle('auth:change-legacy-password', (_event, value: unknown) => {
      if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
      return changeLegacyAdminPassword(database, value);
    });
    ipcMain.handle('auth:login', (_event, credentials: unknown) => {
      if (!database) return { ok: false, message: 'قاعدة البيانات المحلية غير جاهزة.' };
      const result = authenticateUser(database, credentials);
      authenticatedUserId = result.ok ? result.userId ?? 0 : 0;
      return {
        ok: result.ok, message: result.message,
        ...(result.requiresPasswordChange ? { requiresPasswordChange: true } : {}),
      };
    });

    ipcMain.handle('auth:session', () => Boolean(authenticatedUserId));
    ipcMain.handle('auth:landing-page', () => {
      const db = requireAuthentication();
      if (currentUser(db, authenticatedUserId).systemAdmin) return 'dashboard';
      return MODULES.find(({ key }) => hasPermission(db, authenticatedUserId, `${key}.view`))?.key ?? null;
    });
    ipcMain.handle('auth:logout', () => {
      authenticatedUserId = 0;
    });

    ipcMain.handle('preferences:get-theme', () => {
      if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
      const result = database.prepare("SELECT value FROM app_settings WHERE key = 'theme'").get() as Record<string, SQLOutputValue> | undefined;
      return result?.value === 'dark' ? 'dark' : 'light';
    });

    ipcMain.handle('preferences:set-theme', (_event, theme: unknown) => {
      if (!database) throw new Error('قاعدة البيانات المحلية غير جاهزة.');
      if (theme !== 'light' && theme !== 'dark') throw new Error('اختيار المظهر غير صالح.');
      database.prepare("INSERT INTO app_settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(theme);
    });

    ipcMain.handle('settings:general:get', () => {
      const db = requireAuthentication();
      const rows = db.prepare("SELECT key, value FROM app_settings WHERE key IN ('theme', 'invoice_prefix')").all() as Array<Record<string, SQLOutputValue>>;
      const values = new Map(rows.map((row) => [String(row.key), String(row.value)]));
      return {
        theme: values.get('theme') === 'dark' ? 'dark' : 'light',
        invoicePrefix: values.get('invoice_prefix') ?? 'INV',
      };
    });
    ipcMain.handle('settings:general:save', (_event, value: unknown) => {
      const db = requireAuthentication();
      if (!value || typeof value !== 'object') throw new Error('بيانات الإعدادات العامة غير صالحة.');
      const settings = value as { theme?: unknown; invoicePrefix?: unknown };
      if (settings.theme !== 'light' && settings.theme !== 'dark') throw new Error('اختيار المظهر غير صالح.');
      if (typeof settings.invoicePrefix !== 'string') throw new Error('أدخل بادئة صالحة لرقم الفاتورة.');
      const invoicePrefix = settings.invoicePrefix.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{0,11}$/.test(invoicePrefix)) {
        throw new Error('يجب أن تتكون بادئة الفاتورة من 1 إلى 12 حرفًا أو رقمًا، ويمكن استخدام الشرطة والشرطة السفلية.');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        setSetting(db, 'theme', settings.theme);
        setSetting(db, 'invoice_prefix', invoicePrefix);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
    ipcMain.handle('system:data-reset', (_event, confirmation: unknown) => resetOperationalData(confirmation));

    ipcMain.handle('settings:company:get', () => readCompanyProfile(requireAuthentication()));
    ipcMain.handle('settings:company:save', (_event, value: unknown) => {
      const db = requireAuthentication();
      const profile = validateCompanyProfile(value);
      db.exec('BEGIN IMMEDIATE');
      try {
        setSetting(db, 'company_name', profile.nameAr);
        setSetting(db, 'company_name_en', profile.nameEn);
        setSetting(db, 'company_address_ar', profile.addressAr);
        setSetting(db, 'company_address_en', profile.addressEn);
        setSetting(db, 'company_email', profile.email);
        setSetting(db, 'company_phone', profile.phone);
        setSetting(db, 'company_commercial_register', profile.commercialRegister);
        setSetting(db, 'company_tax_number', profile.taxNumber);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
    ipcMain.handle('settings:company:logo', () => uploadCompanyLogo());
    ipcMain.handle('settings:backup:get', () => getBackupState());
    ipcMain.handle('settings:backup:save', (_event, value: unknown) => setBackupPreferences(value));
    ipcMain.handle('settings:backup:choose-directory', async () => {
      requireAuthentication();
      if (!mainWindow) throw new Error('تعذر تحديد نافذة التطبيق.');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'اختيار مجلد النسخ الاحتياطية',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: backupPreferences(requireAuthentication()).directory,
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const selectedDirectory = resolve(result.filePaths[0]);
      if (!statSync(selectedDirectory).isDirectory()) throw new Error('المسار المحدد ليس مجلدًا صالحًا.');
      setSetting(requireAuthentication(), 'backup_directory', selectedDirectory);
      return getBackupState();
    });
    ipcMain.handle('settings:backup:create', () => {
      requireAuthentication();
      return createBackupInternal('manual');
    });
    ipcMain.handle('settings:backup:open-directory', async () => {
      const db = requireAuthentication();
      const directory = backupPreferences(db).directory;
      mkdirSync(directory, { recursive: true });
      const error = await shell.openPath(directory);
      if (error) throw new Error(`تعذر فتح مجلد النسخ: ${error}`);
    });
    ipcMain.handle('settings:backup:choose-restore', () => chooseRestoreBackup());
    ipcMain.handle('settings:backup:restore', () => restoreBackup());

    ipcMain.handle('records:list', (_event, moduleValue: unknown) => {
      const db = requireAuthentication();
      if (!isModuleKey(moduleValue)) throw new Error('القسم المحدد غير صالح.');
      const rows = db.prepare('SELECT * FROM records WHERE module = ? ORDER BY updated_at DESC, id DESC')
        .all(moduleValue) as Record<string, SQLOutputValue>[];
      return rows.map(asRecord);
    });

    ipcMain.handle('records:stats', () => {
      const db = requireAuthentication();
      const stats = Object.fromEntries(MODULES.map(({ key }) => [key, 0])) as RecordStats;
      const rows = db.prepare('SELECT module, COUNT(*) AS count FROM records GROUP BY module')
        .all() as Record<string, SQLOutputValue>[];
      for (const row of rows) {
        if (isModuleKey(row.module)) stats[row.module] = Number(row.count);
      }
      stats.accounts = Number((db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as Record<string, SQLOutputValue>).count);
      stats.reports = Number((db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE status = 'posted'").get() as Record<string, SQLOutputValue>).count);
      return stats;
    });

    ipcMain.handle('dashboard:summary', () => {
      return readDashboardSummary(requireAuthentication());
    });

    ipcMain.handle('records:save', (_event, value: unknown) => {
      const db = requireAuthentication();
      const input = validateRecord(value);
      if (input.id) {
        const result = db.prepare(`
          UPDATE records SET title = ?, reference = ?, party = ?, date = ?, amount = ?,
            status = ?, notes = ?, updated_at = datetime('now')
          WHERE id = ? AND module = ?
        `).run(input.title, input.reference, input.party, input.date, input.amount, input.status, input.notes, input.id, input.module);
        if (result.changes === 0) throw new Error('لم يُعثر على السجل المطلوب في هذا القسم.');
        const row = db.prepare('SELECT * FROM records WHERE id = ?').get(input.id) as Record<string, SQLOutputValue>;
        return asRecord(row);
      }
      const result = db.prepare(`
        INSERT INTO records (module, title, reference, party, date, amount, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.module, input.title, input.reference, input.party, input.date, input.amount, input.status, input.notes);
      const row = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(result.lastInsertRowid)) as Record<string, SQLOutputValue>;
      return asRecord(row);
    });

    ipcMain.handle('records:delete', (_event, value: unknown) => {
      const db = requireAuthentication();
      if (!value || typeof value !== 'object') throw new Error('بيانات السجل غير صالحة.');
      const { id, module } = value as { id?: unknown; module?: unknown };
      if (!Number.isSafeInteger(id) || Number(id) < 1 || !isModuleKey(module)) {
        throw new Error('بيانات السجل غير صالحة.');
      }
      const result = db.prepare('DELETE FROM records WHERE id = ? AND module = ?').run(Number(id), module);
      if (result.changes === 0) throw new Error('لم يُعثر على السجل المطلوب.');
      return true;
    });

    registerAccountingHandlers(requireAuthentication, () => authenticatedUserId);
    registerAssetHandlers(requireAuthentication);
    registerFinancialDocumentHandlers(requireAuthentication);
    registerSalesHandlers(requireAuthentication);
    registerSalesMasterHandlers(requireAuthentication);
    registerSalesReturnHandlers(requireAuthentication);
    registerSalesDashboardHandlers(requireAuthentication);
    registerPurchaseHandlers(requireAuthentication);
    registerInventoryHandlers(requireAuthentication);
    registerInventoryDocumentHandlers(requireAuthentication);
    registerTreasuryHandlers(requireAuthentication);
    registerPortfolioDashboardHandlers(requireAuthentication);
    registerProjectHandlers(requireAuthentication);
    registerPropertySalesHandlers(requireAuthentication);
    registerContractorHandlers(requireAuthentication);
    registerReportHandlers(requireAuthentication);
  }

  function installIpcAuthorization(): void {
    const originalHandle = ipcMain.handle.bind(ipcMain);
    const authOnly = (channel: string): boolean =>
      channel === 'auth:login' || channel === 'auth:session' || channel === 'auth:logout'
      || channel === 'auth:initial-setup-required' || channel === 'auth:initial-setup'
      || channel === 'auth:change-legacy-password'
      || channel === 'preferences:get-theme' || channel === 'system:version';
    const moduleFor = (channel: string, args: unknown[]): string | null => {
      if (channel === 'users:current') return 'self';
      if (channel === 'auth:landing-page') return 'self';
      if (channel === 'system:data-reset') return 'settings';
      if (channel === 'records:stats') return 'dashboard';
      if (channel.startsWith('records:')) {
        const payload = args[0];
        if (typeof payload === 'string') return payload;
        return payload && typeof payload === 'object' && 'module' in payload && typeof payload.module === 'string'
          ? payload.module : null;
      }
      if (channel === 'reports:run') {
        const payload = args[0];
        const key = payload && typeof payload === 'object' && 'key' in payload ? payload.key : null;
        return key === 'installments' ? 'installment-reports' : 'reports';
      }
      if (channel.startsWith('financial-vouchers:')) {
        const payload = args[0];
        const kind = typeof payload === 'string' ? payload
          : payload && typeof payload === 'object' && 'partyKind' in payload ? payload.partyKind
            : payload && typeof payload === 'object' && 'kind' in payload ? payload.kind : null;
        return kind === 'customer' ? 'customer-vouchers' : kind === 'supplier' ? 'supplier-vouchers' : 'treasury';
      }
      if (channel === 'preferences:set-theme') return 'self';
      if (channel.startsWith('settings:') || channel.startsWith('users:') || channel.startsWith('permission-groups:')
        || channel.startsWith('user-permissions:') || channel.startsWith('permissions:')
        || channel.startsWith('accounting-periods:')) return 'settings';
      if (channel.startsWith('dashboard:')) return 'dashboard';
      if (channel.startsWith('sales:')) return 'sales';
      if (channel.startsWith('purchases:')) return 'purchases';
      if (channel.startsWith('inventory:')) return 'inventory';
      if (channel.startsWith('treasury:')) return 'treasury';
      if (channel.startsWith('financial-vouchers:')) return 'treasury';
      if (channel.startsWith('expenses:')) return 'expenses';
      if (channel.startsWith('accounts:') || channel.startsWith('cost-centers:')
        || channel.startsWith('budgets:') || channel.startsWith('journals:')) return 'accounts';
      if (channel.startsWith('reports:trial-balance')) return 'accounts';
      if (channel.startsWith('reports:')) return 'reports';
      if (channel.startsWith('assets:')) return 'assets';
      if (channel === 'property-sales:brokers:list' || channel === 'property-sales:brokers:save'
        || channel === 'property-sales:brokers:delete') return 'brokerage';
      if (channel.startsWith('projects:') || channel.startsWith('property-sales:')
        || channel.startsWith('portfolio-dashboard:')) return 'projects';
      if (channel.startsWith('contractor')) return 'contractors';
      if (channel === 'system:version') return null;
      return null;
    };
    const operationFor = (channel: string, args: unknown[]): string => {
      const action = channel.split(':').at(-1) ?? '';
      if (action === 'list' || action === 'get' || action === 'summary' || action === 'dashboard'
        || action === 'library' || action === 'balances' || action === 'stats' || action === 'report'
        || action === 'payment-list') return 'view';
      if (action === 'approve' || action === 'post' || action === 'save-approve') return 'approve';
      if (action === 'delete') return 'delete';
      if (action === 'export-pdf' || action === 'export-csv' || action === 'pdf') return 'export';
      if (action === 'cancel' || action === 'status') return 'edit';
      if (action === 'save' || action === 'collect' || action === 'create-from') {
        const payload = args[0];
        return payload && typeof payload === 'object' && 'id' in payload && typeof payload.id === 'number'
          ? 'edit' : 'create';
      }
      if (action === 'run') return 'view';
      return 'view';
    };
    Object.defineProperty(ipcMain, 'handle', {
      configurable: true,
      value: new Proxy(originalHandle, {
        apply(target, thisArg, argumentList: unknown[]) {
          const [channelValue, handler] = argumentList;
          const channel = String(channelValue);
          if (typeof handler !== 'function') throw new Error(`Invalid IPC handler for ${channel}.`);
          return Reflect.apply(target, thisArg, [
            channel,
            async (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => {
              if (authOnly(channel) && event.sender.id !== mainWindow?.webContents.id) {
                throw new Error('مصدر الطلب غير موثوق.');
              }
              if (!authOnly(channel)) {
                if (!authenticatedUserId || !database) throw new Error('يرجى تسجيل الدخول أولًا.');
                if (event.sender.id !== mainWindow?.webContents.id) throw new Error('مصدر الطلب غير موثوق.');
                const user = currentUser(database, authenticatedUserId);
                if (!user.active) throw new Error('هذا الحساب موقوف.');
                const module = moduleFor(channel, args);
                if (!module) throw new Error('القناة المطلوبة غير معروفة أو غير مصرح بها.');
                if (module === 'self') return Reflect.apply(handler, undefined, [event, ...args]);
                if (module === 'settings') {
                  if (!user.systemAdmin) throw new Error('تتطلب هذه العملية صلاحية مدير النظام.');
                } else {
                  const permission = `${module}.${operationFor(channel, args)}`;
                  if (!hasPermission(database, authenticatedUserId, permission)) {
                    throw new Error('ليست لديك الصلاحية اللازمة لتنفيذ هذه العملية.');
                  }
                }
              }
              return Reflect.apply(handler, undefined, [event, ...args]);
            },
          ]);
        },
      }),
    });
    ipcMain.handle('assets:depreciation:pdf', async (event) => {
      requireAuthentication();
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error('تعذر تحديد نافذة التطبيق لتصدير التقرير.');
      const testFilename = process.env.ELSAAD_TEST_PDF_FILE?.trim();
      if (testUserData && testFilename && /^[\w.-]+\.pdf$/i.test(testFilename) && !testFilename.includes('..')) {
        const testDirectory = join(app.getPath('userData'), 'screenshots');
        mkdirSync(testDirectory, { recursive: true });
        const testPath = join(testDirectory, testFilename);
        const pdf = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, landscape: true });
        writeFileSync(testPath, pdf);
        return true;
      }
      const destination = await dialog.showSaveDialog(window, {
        title: 'تصدير تقرير إهلاك الأصول',
        defaultPath: 'تقرير-إهلاك-الأصول.pdf',
        filters: [{ name: 'ملف PDF', extensions: ['pdf'] }],
      });
      if (destination.canceled || !destination.filePath) return false;
      const pdf = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, landscape: true });
      writeFileSync(destination.filePath, pdf);
      return true;
    });
    ipcMain.handle('system:version', () => app.getVersion());
    registerUserHandlers(requireAuthentication, () => authenticatedUserId);
  }

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1080,
      minHeight: 700,
      show: false,
      backgroundColor: '#f7f6f3',
      title: 'Elsaad ERP',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      void mainWindow.loadURL(devServerUrl);
    } else {
      void mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
    }
  }

  app.whenReady().then(() => {
    try {
      installDatabase();
      installHandlers();
      scheduleAutomaticBackup();
      Menu.setApplicationMenu(null);
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تهيئة التطبيق.';
      console.error('Elsaad ERP startup failed:', error);
      dialog.showErrorBox('تعذر تشغيل Elsaad ERP', message);
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (automaticBackupTimer) clearInterval(automaticBackupTimer);
    database?.close();
  });
}
