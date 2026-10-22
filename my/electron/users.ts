import { ipcMain } from 'electron';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { MODULES } from '../src/shared/modules.js';
import type {
  ManagedUser, PermissionDefinition, PermissionGroup, PermissionGroupInput, PermissionOperation,
  UserInput, UserPermissionInput, UserPermissionState,
} from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const OPERATION_LABELS: Record<PermissionOperation, string> = {
  view: 'عرض', create: 'إضافة', edit: 'تعديل', delete: 'حذف', approve: 'اعتماد', export: 'طباعة / تصدير',
};
const ADMIN_MODULES = new Set(['settings', 'users', 'permission-groups', 'user-permissions']);
const MODULE_OPERATIONS: ReadonlyArray<{ module: string; operations: readonly PermissionOperation[] }> = [
  { module: 'dashboard', operations: ['view'] },
  { module: 'sales', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'purchases', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'inventory', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'treasury', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'projects', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'contractors', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'brokerage', operations: ['view', 'create', 'edit', 'delete'] },
  { module: 'customer-vouchers', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'supplier-vouchers', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'expenses', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'accounts', operations: ['view', 'create', 'edit', 'delete', 'approve'] },
  { module: 'assets', operations: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  { module: 'reports', operations: ['view', 'export'] },
  { module: 'installment-reports', operations: ['view', 'export'] },
];

export function permissionDefinitions(): PermissionDefinition[] {
  const labels = new Map(MODULES.map(({ key, label }) => [key, label]));
  return MODULE_OPERATIONS.flatMap(({ module, operations }) =>
    operations.map((operation) => ({
      key: `${module}.${operation}`, module: module as PermissionDefinition['module'],
      moduleLabel: labels.get(module as PermissionDefinition['module']) ?? module,
      operation, label: OPERATION_LABELS[operation],
    })),
  );
}

export function installUserSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS permission_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      is_system_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_system_admin IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      group_id INTEGER REFERENCES permission_groups(id) ON DELETE RESTRICT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      is_system_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_system_admin IN (0, 1)),
      password_change_required INTEGER NOT NULL DEFAULT 0 CHECK (password_change_required IN (0, 1)),
      last_login_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS users_group_id ON users(group_id);
    CREATE TABLE IF NOT EXISTS group_permissions (
      group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      PRIMARY KEY (group_id, permission_key)
    );
    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
      PRIMARY KEY (user_id, permission_key)
    );
  `);
  const userColumns = database.prepare('PRAGMA table_info(users)').all() as Row[];
  if (!userColumns.some((column) => column.name === 'password_change_required')) {
    database.exec("ALTER TABLE users ADD COLUMN password_change_required INTEGER NOT NULL DEFAULT 0 CHECK (password_change_required IN (0, 1))");
  }
  const definitions = permissionDefinitions();
  const operational = definitions.filter(({ module }) => !ADMIN_MODULES.has(module)).map(({ key }) => key);
  database.prepare(`
    INSERT OR IGNORE INTO permission_groups (id, name, description, is_system_admin)
    VALUES (1, 'مدير النظام', 'كامل الصلاحيات الإدارية للنظام.', 1)
  `).run();
  database.prepare(`
    INSERT OR IGNORE INTO permission_groups (id, name, description)
    VALUES (2, 'مستخدم تشغيلي', 'الصلاحيات التشغيلية الأساسية دون إدارة المستخدمين أو إعدادات النظام الحساسة.')
  `).run();
  const addGroupPermission = database.prepare('INSERT OR IGNORE INTO group_permissions (group_id, permission_key) VALUES (2, ?)');
  for (const permission of operational) addGroupPermission.run(permission);

  const legacyAdmin = database.prepare("SELECT id, password_hash FROM users WHERE username = 'admin' COLLATE NOCASE").get() as Row | undefined;
  if (legacyAdmin && verifyPassword('Admin123', String(legacyAdmin.password_hash))) {
    database.prepare('UPDATE users SET password_change_required = 1 WHERE id = ?').run(Number(legacyAdmin.id));
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[0-9a-f]{32}$/i.test(parts[1]) || !/^[0-9a-f]{128}$/i.test(parts[2])) return false;
  const expected = Buffer.from(parts[2], 'hex');
  const supplied = scryptSync(password, parts[1], 64);
  return timingSafeEqual(supplied, expected);
}

function validateStrongPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128
    || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new Error('يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل، وأن تشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا.');
  }
  if (value === 'Admin123') throw new Error('لا يمكن استخدام كلمة المرور الافتراضية.');
  return value;
}

export function initialSetupRequired(database: DatabaseSync): boolean {
  return Number((database.prepare('SELECT COUNT(*) AS count FROM users').get() as Row).count) === 0;
}

export function initializeSystemAdmin(database: DatabaseSync, value: unknown): number {
  if (!value || typeof value !== 'object') throw new Error('بيانات الإعداد الأولي غير صالحة.');
  const input = value as { password?: unknown; confirmPassword?: unknown };
  const password = validateStrongPassword(input.password);
  if (input.confirmPassword !== password) throw new Error('تأكيد كلمة المرور غير مطابق.');
  database.exec('BEGIN IMMEDIATE');
  try {
    if (!initialSetupRequired(database)) throw new Error('تم إعداد مدير النظام بالفعل؛ لا يمكن إعادة الإعداد الأولي.');
    const group = database.prepare('SELECT id FROM permission_groups WHERE id = 1 AND is_system_admin = 1').get() as Row | undefined;
    if (!group) throw new Error('مجموعة مدير النظام غير متاحة في قاعدة البيانات.');
    const result = database.prepare(`INSERT INTO users
      (username, full_name, password_hash, group_id, is_system_admin, password_change_required)
      VALUES ('admin', 'مدير النظام', ?, ?, 1, 0)`).run(hashPassword(password), Number(group.id));
    database.exec('COMMIT');
    return Number(result.lastInsertRowid);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function changeLegacyAdminPassword(database: DatabaseSync, value: unknown): boolean {
  if (!value || typeof value !== 'object') throw new Error('بيانات تغيير كلمة المرور غير صالحة.');
  const input = value as { username?: unknown; currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown };
  if (typeof input.username !== 'string' || typeof input.currentPassword !== 'string') {
    throw new Error('أدخل اسم المستخدم وكلمة المرور الحالية.');
  }
  const newPassword = validateStrongPassword(input.newPassword);
  if (input.confirmPassword !== newPassword) throw new Error('تأكيد كلمة المرور غير مطابق.');
  const row = database.prepare(`SELECT id, password_hash FROM users
    WHERE username = ? COLLATE NOCASE AND is_active = 1 AND password_change_required = 1`)
    .get(input.username.trim()) as Row | undefined;
  if (!row || !verifyPassword(input.currentPassword, String(row.password_hash))) {
    throw new Error('بيانات الحساب غير صحيحة أو لا يتطلب الحساب تغيير كلمة المرور.');
  }
  database.prepare(`UPDATE users SET password_hash = ?, password_change_required = 0,
    updated_at = datetime('now') WHERE id = ?`).run(hashPassword(newPassword), Number(row.id));
  return true;
}

function mapUser(row: Row): ManagedUser {
  return {
    id: Number(row.id), username: String(row.username), fullName: String(row.full_name),
    email: String(row.email), phone: String(row.phone),
    groupId: row.group_id === null ? null : Number(row.group_id), groupName: String(row.group_name ?? ''),
    active: Number(row.is_active) === 1, systemAdmin: Number(row.is_system_admin) === 1,
    lastLoginAt: String(row.last_login_at), notes: String(row.notes),
  };
}

const USER_SELECT = `
  SELECT users.*, COALESCE(permission_groups.name, '') AS group_name
  FROM users LEFT JOIN permission_groups ON permission_groups.id = users.group_id
`;

function getUser(database: DatabaseSync, id: number): ManagedUser {
  const row = database.prepare(`${USER_SELECT} WHERE users.id = ?`).get(id) as Row | undefined;
  if (!row) throw new Error('المستخدم المطلوب غير موجود.');
  return mapUser(row);
}

function getPermissionGroup(database: DatabaseSync, id: number): PermissionGroup {
  const row = database.prepare('SELECT * FROM permission_groups WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('مجموعة الصلاحيات غير موجودة.');
  return {
    id, name: String(row.name), description: String(row.description), active: Number(row.is_active) === 1,
    permissions: (database.prepare('SELECT permission_key FROM group_permissions WHERE group_id = ? ORDER BY permission_key')
      .all(id) as Row[]).map((permission) => String(permission.permission_key)),
  };
}

function text(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new Error(`${label} مطلوب وبحد أقصى ${maximum} حرفًا.`);
  }
  return value.trim();
}

function positiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} غير صالح.`);
  return Number(value);
}

export function authenticateUser(database: DatabaseSync, value: unknown): { ok: boolean; userId?: number; message: string; requiresPasswordChange?: boolean } {
  if (!value || typeof value !== 'object') return { ok: false, message: 'أدخل اسم المستخدم وكلمة المرور.' };
  const { username, password } = value as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string') return { ok: false, message: 'أدخل اسم المستخدم وكلمة المرور.' };
  const row = database.prepare(`
    SELECT users.id, users.password_hash, users.password_change_required
    FROM users LEFT JOIN permission_groups ON permission_groups.id = users.group_id
    WHERE users.username = ? AND users.is_active = 1
      AND (users.is_system_admin = 1 OR permission_groups.is_active = 1)
  `).get(username.trim()) as Row | undefined;
  if (!row || !verifyPassword(password, String(row.password_hash))) {
    return { ok: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة أو أن الحساب موقوف.' };
  }
  if (Number(row.password_change_required) === 1) {
    return {
      ok: false, requiresPasswordChange: true,
      message: 'هذه قاعدة بيانات قديمة تستخدم كلمة مرور الإعداد الافتراضية. عيّن كلمة مرور جديدة قبل المتابعة.',
    };
  }
  const userId = Number(row.id);
  database.prepare("UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(userId);
  return { ok: true, userId, message: '' };
}

export function currentUser(database: DatabaseSync, userId: number): ManagedUser {
  return getUser(database, userId);
}

export function hasPermission(database: DatabaseSync, userId: number, permissionKey: string): boolean {
  const user = database.prepare(`
    SELECT users.is_system_admin, permission_groups.is_active AS group_active
    FROM users LEFT JOIN permission_groups ON permission_groups.id = users.group_id
    WHERE users.id = ? AND users.is_active = 1
  `).get(userId) as Row | undefined;
  if (!user) return false;
  if (Number(user.is_system_admin) === 1) return true;
  const override = database.prepare('SELECT allowed FROM user_permission_overrides WHERE user_id = ? AND permission_key = ?')
    .get(userId, permissionKey) as Row | undefined;
  if (override) return Number(override.allowed) === 1;
  if (Number(user.group_active) !== 1) return false;
  return Boolean(database.prepare('SELECT 1 FROM group_permissions WHERE group_id = (SELECT group_id FROM users WHERE id = ?) AND permission_key = ?')
    .get(userId, permissionKey));
}

function requireAdmin(database: DatabaseSync, userId: number): void {
  const row = database.prepare('SELECT is_system_admin FROM users WHERE id = ? AND is_active = 1').get(userId) as Row | undefined;
  if (!row || Number(row.is_system_admin) !== 1) throw new Error('تتطلب هذه العملية صلاحية مدير النظام.');
}

export function registerUserHandlers(getDatabase: () => DatabaseSync, getCurrentUserId: () => number): void {
  const adminDatabase = (): { db: DatabaseSync; userId: number } => {
    const db = getDatabase();
    const userId = getCurrentUserId();
    requireAdmin(db, userId);
    return { db, userId };
  };
  ipcMain.handle('users:current', () => getUser(getDatabase(), getCurrentUserId()));
  ipcMain.handle('users:list', (_event, searchValue: unknown) => {
    const { db } = adminDatabase();
    const search = typeof searchValue === 'string' ? `%${searchValue.trim()}%` : '%';
    return (db.prepare(`${USER_SELECT} WHERE users.username LIKE ? OR users.full_name LIKE ? ORDER BY users.full_name, users.id`)
      .all(search, search) as Row[]).map(mapUser);
  });
  ipcMain.handle('users:save', (_event, value: unknown) => {
    const { db, userId: actorId } = adminDatabase();
    if (!value || typeof value !== 'object') throw new Error('بيانات المستخدم غير صالحة.');
    const input = value as Partial<UserInput>;
    const username = text(input.username, 'اسم المستخدم', 60, true);
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(username)) throw new Error('اسم المستخدم يقبل الحروف والأرقام والنقطة والشرطة فقط.');
    const fullName = text(input.fullName, 'الاسم الكامل', 180, true);
    const email = text(input.email, 'البريد الإلكتروني', 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('صيغة البريد الإلكتروني غير صحيحة.');
    const phone = text(input.phone, 'رقم الهاتف', 40);
    const notes = text(input.notes, 'الملاحظات', 2000);
    if (typeof input.active !== 'boolean' || typeof input.systemAdmin !== 'boolean') throw new Error('حالة المستخدم غير صالحة.');
    const id = input.id === undefined ? undefined : positiveId(input.id, 'رقم المستخدم');
    const password = input.password;
    if (id === undefined && typeof password !== 'string') throw new Error('كلمة المرور مطلوبة للمستخدم الجديد.');
    if (typeof password === 'string' && password && password.length < 12) throw new Error('يجب ألا تقل كلمة المرور الجديدة عن 12 حرفًا.');
    if (id === actorId && (!input.active || !input.systemAdmin)) throw new Error('لا يمكن لمدير النظام إيقاف حسابه أو إزالة صلاحية المدير عن نفسه.');
    let groupId: number | null = null;
    if (input.groupId !== null && input.groupId !== undefined) {
      groupId = positiveId(input.groupId, 'مجموعة الصلاحيات');
      const group = db.prepare('SELECT is_active, is_system_admin FROM permission_groups WHERE id = ?').get(groupId) as Row | undefined;
      if (!group || Number(group.is_active) !== 1) throw new Error('مجموعة الصلاحيات غير موجودة أو موقوفة.');
      if (input.systemAdmin && Number(group.is_system_admin) !== 1) groupId = Number(db.prepare('SELECT id FROM permission_groups WHERE is_system_admin = 1').get()?.id);
      if (!input.systemAdmin && Number(group.is_system_admin) === 1) throw new Error('اختر مجموعة تشغيلية لحساب غير المدير.');
    } else if (!input.systemAdmin) {
      groupId = Number(db.prepare('SELECT id FROM permission_groups WHERE is_system_admin = 0 AND is_active = 1 ORDER BY id LIMIT 1').get()?.id);
      if (!groupId) throw new Error('أنشئ مجموعة تشغيلية مفعّلة أولًا.');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (id === undefined) {
        const result = db.prepare(`
          INSERT INTO users (username, full_name, email, phone, password_hash, group_id, is_active, is_system_admin, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(username, fullName, email, phone, hashPassword(password as string), groupId, Number(input.active), Number(input.systemAdmin), notes);
        const newId = Number(result.lastInsertRowid);
        db.exec('COMMIT');
        return getUser(db, newId);
      }
      const existing = db.prepare('SELECT is_system_admin FROM users WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error('المستخدم المطلوب غير موجود.');
      if (Number(existing.is_system_admin) === 1 && !input.systemAdmin) throw new Error('لا يمكن إزالة صفة مدير النظام من حساب مدير موجود.');
      const passwordHash = typeof password === 'string' && password ? hashPassword(password) : null;
      db.prepare(`
        UPDATE users SET username=?, full_name=?, email=?, phone=?, group_id=?, is_active=?, is_system_admin=?, notes=?,
          password_hash=COALESCE(?, password_hash), updated_at=datetime('now') WHERE id=?
      `).run(username, fullName, email, phone, groupId, Number(input.active), Number(input.systemAdmin), notes, passwordHash, id);
      db.exec('COMMIT');
      return getUser(db, id);
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.username')) {
        throw new Error('اسم المستخدم مستخدم بالفعل.');
      }
      throw error;
    }
  });
  ipcMain.handle('users:active', (_event, value: unknown) => {
    const { db, userId: actorId } = adminDatabase();
    if (!value || typeof value !== 'object') throw new Error('طلب تغيير حالة المستخدم غير صالح.');
    const input = value as { id?: unknown; active?: unknown };
    const id = positiveId(input.id, 'رقم المستخدم');
    if (typeof input.active !== 'boolean') throw new Error('حالة المستخدم غير صالحة.');
    if (id === actorId && !input.active) throw new Error('لا يمكن إيقاف حساب المدير المستخدم حاليًا.');
    const result = db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ? AND is_system_admin = 0")
      .run(Number(input.active), id);
    if (result.changes !== 1) throw new Error('لا يمكن إيقاف مدير النظام أو أن المستخدم غير موجود.');
    return getUser(db, id);
  });
  ipcMain.handle('permissions:definitions', () => { adminDatabase(); return permissionDefinitions(); });
  ipcMain.handle('permission-groups:list', (_event, searchValue: unknown) => {
    const { db } = adminDatabase();
    const search = typeof searchValue === 'string' ? `%${searchValue.trim()}%` : '%';
    const rows = db.prepare('SELECT * FROM permission_groups WHERE name LIKE ? ORDER BY is_system_admin DESC, name').all(search) as Row[];
    return rows.map((row): PermissionGroup => ({
      id: Number(row.id), name: String(row.name), description: String(row.description),
      active: Number(row.is_active) === 1,
      permissions: (db.prepare('SELECT permission_key FROM group_permissions WHERE group_id = ? ORDER BY permission_key')
        .all(Number(row.id)) as Row[]).map((permission) => String(permission.permission_key)),
    }));
  });
  ipcMain.handle('permission-groups:save', (_event, value: unknown) => {
    const { db } = adminDatabase();
    if (!value || typeof value !== 'object') throw new Error('بيانات مجموعة الصلاحيات غير صالحة.');
    const input = value as Partial<PermissionGroupInput>;
    const name = text(input.name, 'اسم المجموعة', 100, true);
    const description = text(input.description, 'وصف المجموعة', 500);
    if (typeof input.active !== 'boolean' || !Array.isArray(input.permissions)) throw new Error('إعدادات المجموعة غير صالحة.');
    const id = input.id === undefined ? undefined : positiveId(input.id, 'رقم المجموعة');
    if (id !== undefined) {
      const current = db.prepare('SELECT is_system_admin FROM permission_groups WHERE id = ?').get(id) as Row | undefined;
      if (!current) throw new Error('مجموعة الصلاحيات غير موجودة.');
      if (Number(current.is_system_admin)) throw new Error('مجموعة مدير النظام محمية ولا يمكن تعديلها.');
    }
    const allowed = new Set(permissionDefinitions().filter(({ module }) => !ADMIN_MODULES.has(module)).map(({ key }) => key));
    const permissions = [...new Set(input.permissions.filter((permission): permission is string => typeof permission === 'string'))];
    if (permissions.some((permission) => !allowed.has(permission))) throw new Error('تتضمن المجموعة صلاحية إدارية محمية أو غير معروفة.');
    db.exec('BEGIN IMMEDIATE');
    try {
      let groupId: number;
      if (id === undefined) {
        groupId = Number(db.prepare('INSERT INTO permission_groups (name, description, is_active) VALUES (?, ?, ?)').run(name, description, Number(input.active)).lastInsertRowid);
      } else {
        db.prepare("UPDATE permission_groups SET name=?, description=?, is_active=?, updated_at=datetime('now') WHERE id=?")
          .run(name, description, Number(input.active), id);
        groupId = id;
      }
      db.prepare('DELETE FROM group_permissions WHERE group_id = ?').run(groupId);
      const insert = db.prepare('INSERT INTO group_permissions (group_id, permission_key) VALUES (?, ?)');
      for (const permission of permissions) insert.run(groupId, permission);
      db.exec('COMMIT');
      return getPermissionGroup(db, groupId);
    } catch (error) {
      db.exec('ROLLBACK');
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('اسم المجموعة مستخدم بالفعل.');
      throw error;
    }
  });
  ipcMain.handle('user-permissions:get', (_event, idValue: unknown) => {
    const { db } = adminDatabase();
    return permissionState(db, positiveId(idValue, 'رقم المستخدم'));
  });
  ipcMain.handle('user-permissions:save', (_event, value: unknown) => {
    const { db } = adminDatabase();
    if (!value || typeof value !== 'object') throw new Error('بيانات الصلاحيات غير صالحة.');
    const input = value as Partial<UserPermissionInput>;
    const userId = positiveId(input.userId, 'رقم المستخدم');
    const user = getUser(db, userId);
    if (user.systemAdmin) throw new Error('لا يمكن تعديل الصلاحيات المباشرة لمدير النظام.');
    if (!input.overrides || typeof input.overrides !== 'object' || Array.isArray(input.overrides)) throw new Error('تخصيص الصلاحيات غير صالح.');
    const valid = new Set(permissionDefinitions().filter(({ module }) => !ADMIN_MODULES.has(module)).map(({ key }) => key));
    const entries = Object.entries(input.overrides);
    if (entries.some(([key, allowed]) => !valid.has(key) || typeof allowed !== 'boolean')) throw new Error('يتضمن التخصيص صلاحية غير معروفة.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(userId);
      const insert = db.prepare('INSERT INTO user_permission_overrides (user_id, permission_key, allowed) VALUES (?, ?, ?)');
      for (const [key, allowed] of entries) insert.run(userId, key, Number(allowed));
      db.exec('COMMIT');
      return permissionState(db, userId);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  ipcMain.handle('user-permissions:reset', (_event, idValue: unknown) => {
    const { db } = adminDatabase();
    const id = positiveId(idValue, 'رقم المستخدم');
    if (getUser(db, id).systemAdmin) throw new Error('حساب مدير النظام لا يحتاج إلى تخصيص مباشر.');
    db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(id);
    return permissionState(db, id);
  });
}

function permissionState(database: DatabaseSync, userId: number): UserPermissionState {
  const user = getUser(database, userId);
  const inherited = user.groupId === null ? [] : (database.prepare('SELECT permission_key FROM group_permissions WHERE group_id = ?')
    .all(user.groupId) as Row[]).map((row) => String(row.permission_key));
  const overrideRows = database.prepare('SELECT permission_key, allowed FROM user_permission_overrides WHERE user_id = ?')
    .all(userId) as Row[];
  const overrides = Object.fromEntries(overrideRows.map((row) => [String(row.permission_key), Number(row.allowed) === 1]));
  const effective = permissionDefinitions().filter(({ key }) => overrides[key] ?? inherited.includes(key)).map(({ key }) => key);
  return { user, inherited, overrides, effective };
}
