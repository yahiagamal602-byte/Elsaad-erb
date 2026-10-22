import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  authenticateUser,
  changeLegacyAdminPassword,
  initialSetupRequired,
  initializeSystemAdmin,
  installUserSchema,
} from '../electron/users.ts';

const strongPassword = 'Elsaad#Secure2026';

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  installUserSchema(database);
  return database;
}

test('new database requires first-run setup, rejects login before setup, and accepts the chosen password afterward', () => {
  const database = fixture();
  assert.equal(initialSetupRequired(database), true);
  assert.equal(authenticateUser(database, { username: 'admin', password: 'Admin123' }).ok, false);
  assert.equal(authenticateUser(database, { username: 'admin', password: strongPassword }).ok, false);

  assert.throws(() => initializeSystemAdmin(database, {
    password: 'weak', confirmPassword: 'weak',
  }), /12 حرفًا على الأقل/);
  assert.equal(initialSetupRequired(database), true);
  assert.throws(() => initializeSystemAdmin(database, {
    password: strongPassword, confirmPassword: 'Different#Password2026',
  }), /غير مطابق/);
  assert.equal(initialSetupRequired(database), true);

  const userId = initializeSystemAdmin(database, { password: strongPassword, confirmPassword: strongPassword });
  assert.ok(userId > 0);
  assert.equal(initialSetupRequired(database), false);
  assert.equal(authenticateUser(database, { username: 'admin', password: 'Admin123' }).ok, false);
  assert.equal(authenticateUser(database, { username: 'admin', password: strongPassword }).userId, userId);
  assert.throws(() => initializeSystemAdmin(database, {
    password: 'Another#Strong2026', confirmPassword: 'Another#Strong2026',
  }), /تم إعداد مدير النظام بالفعل/);
  database.close();
});

test('legacy default-password accounts must change password before login and retain their account', () => {
  const database = fixture();
  const userId = initializeSystemAdmin(database, { password: strongPassword, confirmPassword: strongPassword });
  const salt = '0123456789abcdef0123456789abcdef';
  const legacyHash = `scrypt$${salt}$${scryptSync('Admin123', salt, 64).toString('hex')}`;
  database.prepare('UPDATE users SET password_hash = ?, password_change_required = 0 WHERE id = ?').run(legacyHash, userId);
  installUserSchema(database);

  const blocked = authenticateUser(database, { username: 'admin', password: 'Admin123' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.requiresPasswordChange, true);
  assert.throws(() => changeLegacyAdminPassword(database, {
    username: 'admin', currentPassword: 'wrong', newPassword: 'Replacement#2026', confirmPassword: 'Replacement#2026',
  }), /بيانات الحساب غير صحيحة/);

  assert.equal(changeLegacyAdminPassword(database, {
    username: 'admin', currentPassword: 'Admin123',
    newPassword: 'Replacement#2026', confirmPassword: 'Replacement#2026',
  }), true);
  const authenticated = authenticateUser(database, { username: 'admin', password: 'Replacement#2026' });
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.userId, userId);
  assert.equal(Number((database.prepare('SELECT password_change_required FROM users WHERE id = ?').get(userId) as { password_change_required: number }).password_change_required), 0);
  database.close();
});

test('schema upgrade preserves existing accounts and app data while adding setup compatibility', () => {
  const database = fixture();
  const userId = initializeSystemAdmin(database, { password: strongPassword, confirmPassword: strongPassword });
  database.exec(`
    CREATE TABLE records (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    INSERT INTO records (id, title) VALUES (1, 'Existing record');
    ALTER TABLE users DROP COLUMN password_change_required;
  `);

  installUserSchema(database);

  assert.equal(initialSetupRequired(database), false);
  assert.equal(Number((database.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: number }).id), userId);
  assert.equal((database.prepare('SELECT title FROM records WHERE id = 1').get() as { title: string }).title, 'Existing record');
  assert.equal(authenticateUser(database, { username: 'admin', password: strongPassword }).ok, true);
  assert.equal(Number((database.prepare('SELECT password_change_required FROM users WHERE id = ?').get(userId) as { password_change_required: number }).password_change_required), 0);
  database.close();
});
