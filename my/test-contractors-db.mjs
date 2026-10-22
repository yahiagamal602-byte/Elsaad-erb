import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dbPath = join(tmpdir(), `elsaad-test-${Date.now()}.sqlite`);
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE records (
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

  CREATE TABLE contractors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_record_id INTEGER UNIQUE REFERENCES records(id) ON DELETE RESTRICT,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    specialty TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    governorate TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX contractors_name_status ON contractors(name COLLATE NOCASE, status);

  CREATE TABLE contractor_opening_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
    entry_date TEXT NOT NULL,
    debit TEXT NOT NULL,
    credit TEXT NOT NULL,
    base_equivalent TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX contractor_opening_entries_date ON contractor_opening_entries(contractor_id, entry_date, id);

  CREATE TABLE contractor_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    contract_date TEXT NOT NULL,
    contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
    project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    total TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX contractor_contracts_contractor_date ON contractor_contracts(contractor_id, contract_date DESC, id DESC);
  CREATE INDEX contractor_contracts_project_date ON contractor_contracts(project_id, contract_date DESC, id DESC);

  CREATE TABLE contractor_contract_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contractor_contracts(id) ON DELETE CASCADE,
    line_order INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity TEXT NOT NULL,
    unit_price TEXT NOT NULL,
    line_total TEXT NOT NULL,
    UNIQUE(contract_id, line_order),
    UNIQUE(contract_id, code)
  );
  CREATE INDEX contractor_contract_lines_contract ON contractor_contract_lines(contract_id, line_order);

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','in-progress','on-hold','completed','cancelled'))
  );
`);

const insertProject = db.prepare('INSERT INTO projects (code, name, status) VALUES (?, ?, ?)');
insertProject.run('P-001', 'المشروع التجريبي', 'active');

const insertContractor = db.prepare(`INSERT INTO contractors (code, name, phone, specialty, country, governorate, address, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const insertOpening = db.prepare(`INSERT INTO contractor_opening_entries (contractor_id, entry_date, debit, credit, base_equivalent, status)
  VALUES (?, ?, ?, ?, ?, ?)`);

const contractorId = insertContractor.run('CON-000001', 'مقاول تجريبي أول', '01234567890', 'مقاولات مبانٍ', 'مصر', 'القاهرة', 'شارع التجريبي', 'active').lastInsertRowid;
insertOpening.run(contractorId, '2026-01-01', '10000.00', '0.00', '10000.00', 'active');
insertOpening.run(contractorId, '2026-01-15', '0.00', '3000.00', '3000.00', 'active');

const contractorCount = Number((db.prepare('SELECT COUNT(*) AS count FROM contractors').get()).count);
assert.equal(contractorCount, 1, 'يُنشأ مقاول واحد فقط.');

assert.throws(() => {
  insertContractor.run('CON-000001', 'مقاول مكرر', '01111111111', 'نجارة', 'مصر', 'الجيزة', 'عنوان', 'active');
}, /UNIQUE|duplicate|constraint/i, 'يُمنع تكرار كود المقاول.');

const SCALE = 10n ** 12n;
const parseAmount = (value) => {
  const match = /^(\d{1,15})(?:\.(\d{1,12}))?$/.exec(String(value).trim());
  if (!match) throw new Error(`Invalid amount: ${value}`);
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(12, '0'));
  return whole * SCALE + fraction;
};
const formatAmount = (value) => {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
};
const calculateLineTotal = (quantity, unitPrice) => formatAmount((parseAmount(quantity) * parseAmount(unitPrice) + SCALE / 2n) / SCALE);

const contractInsert = db.prepare(`INSERT INTO contractor_contracts (number, contract_date, contractor_id, project_id, status, notes, total)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const lineInsert = db.prepare(`INSERT INTO contractor_contract_lines
  (contract_id, line_order, code, name, item_type, unit, quantity, unit_price, line_total)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const contractId = contractInsert.run('CC-2026-000001', '2026-02-01', contractorId, 1, 'draft', 'ملاحظات', '0').lastInsertRowid;
lineInsert.run(contractId, 1, 'B-001', 'بلوك أسمنت', 'مواد', 'طن', '10', '150.50', calculateLineTotal('10', '150.50'));
lineInsert.run(contractId, 2, 'B-002', 'حديد تسليح', 'مواد', 'طن', '5', '120.00', calculateLineTotal('5', '120.00'));
const computedTotal = (parseAmount(calculateLineTotal('10', '150.50')) + parseAmount(calculateLineTotal('5', '120.00')));
assert.equal(formatAmount(computedTotal), '2105', 'يُحسب إجمالي العقد من البنود بطريقة صحيحة.');

console.log('All contractor DB checks passed.');
db.close();

