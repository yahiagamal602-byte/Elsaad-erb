import { ipcMain } from 'electron';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type { Project, ProjectInput, ProjectStatus, ProjectWorkItem, ProjectWorkItemInput } from '../src/shared/types.js';

type Row = Record<string, SQLOutputValue>;
const PROJECT_STATUSES: readonly ProjectStatus[] = ['new', 'in-progress', 'on-hold', 'completed', 'cancelled'];

export function installProjectsSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS project_imported_records (
      record_id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE RESTRICT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      legacy_record_id INTEGER UNIQUE REFERENCES records(id) ON DELETE RESTRICT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      cost_center TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in-progress', 'on-hold', 'completed', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS projects_status_dates ON projects(status, start_date, end_date);
    CREATE TABLE IF NOT EXISTS project_work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES project_work_items(id) ON DELETE RESTRICT,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (parent_id IS NULL OR parent_id <> id)
    );
    CREATE INDEX IF NOT EXISTS project_work_items_project_tree ON project_work_items(project_id, parent_id, code);
    INSERT OR IGNORE INTO projects (id, legacy_record_id, code, name, start_date, status, created_at, updated_at)
      SELECT records.id, records.id,
        CASE WHEN NULLIF(TRIM(reference), '') IS NULL
          OR (SELECT COUNT(*) FROM records AS duplicates WHERE duplicates.module = 'projects'
              AND lower(TRIM(duplicates.reference)) = lower(TRIM(records.reference))) > 1
          OR EXISTS (SELECT 1 FROM projects AS existing WHERE existing.code = TRIM(records.reference) COLLATE NOCASE)
          THEN 'LEGACY-' || id ELSE TRIM(reference) END,
        title,
        CASE WHEN date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN date ELSE '' END,
        CASE status WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled'
          WHEN 'in-progress' THEN 'in-progress' ELSE 'new' END,
        created_at, updated_at
      FROM records WHERE module = 'projects'
        AND NOT EXISTS (SELECT 1 FROM project_imported_records WHERE record_id = records.id);
    INSERT OR IGNORE INTO project_imported_records (record_id)
      SELECT id FROM records WHERE module = 'projects';
  `);
}

function validDate(value: string, optional = false): boolean {
  if (optional && value === '') return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateProject(value: unknown): ProjectInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات المشروع غير صالحة.');
  const input = value as Partial<ProjectInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || Number(input.id) < 1)) throw new Error('رقم المشروع غير صالح.');
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود مشروع حتى 40 حرفًا.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم مشروع حتى 180 حرفًا.');
  if (typeof input.startDate !== 'string' || !validDate(input.startDate)) throw new Error('تاريخ بداية المشروع غير صالح.');
  if (typeof input.endDate !== 'string' || !validDate(input.endDate, true)) throw new Error('تاريخ نهاية المشروع غير صالح.');
  if (input.endDate && input.endDate < input.startDate) throw new Error('تاريخ نهاية المشروع لا يمكن أن يسبق تاريخ البداية.');
  if (typeof input.costCenter !== 'string' || input.costCenter.length > 160) throw new Error('مركز التكلفة غير صالح.');
  if (!PROJECT_STATUSES.includes(input.status as ProjectStatus)) throw new Error('حالة المشروع غير صالحة.');
  return {
    id: input.id, code: input.code.trim(), name: input.name.trim(), startDate: input.startDate,
    endDate: input.endDate, costCenter: input.costCenter.trim(), status: input.status as ProjectStatus,
  };
}

function mapProject(row: Row): Project {
  const start = String(row.start_date);
  const end = String(row.end_date);
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = end ? new Date(`${end}T00:00:00Z`) : null;
  const durationDays = endDate ? Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1 : null;
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), startDate: start, endDate: end,
    durationDays, costCenter: String(row.cost_center), status: String(row.status) as ProjectStatus,
    workItemCount: Number(row.work_item_count ?? 0), issueCount: Number(row.issue_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function projectRows(database: DatabaseSync): Project[] {
  return (database.prepare(`
    SELECT projects.*,
      (SELECT COUNT(*) FROM project_work_items WHERE project_id = projects.id) AS work_item_count,
      (SELECT COUNT(*) FROM inventory_issues WHERE project_id = projects.id AND status <> 'cancelled') AS issue_count
    FROM projects ORDER BY projects.code COLLATE NOCASE, projects.id
  `).all() as Row[]).map(mapProject);
}

function validateWorkItem(value: unknown): ProjectWorkItemInput {
  if (!value || typeof value !== 'object') throw new Error('بيانات بند الأعمال غير صالحة.');
  const input = value as Partial<ProjectWorkItemInput>;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new Error('رقم البند غير صالح.');
  if (!Number.isSafeInteger(input.projectId) || Number(input.projectId) < 1) throw new Error('اختر المشروع.');
  const parentId = input.parentId === undefined ? null : input.parentId;
  if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 40) throw new Error('أدخل كود بند حتى 40 حرفًا.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 180) throw new Error('أدخل اسم بند حتى 180 حرفًا.');
  if (parentId !== null && (!Number.isSafeInteger(parentId) || Number(parentId) < 1)) throw new Error('البند الرئيسي غير صالح.');
  if (typeof input.description !== 'string' || input.description.length > 2000) throw new Error('وصف البند غير صالح.');
  if (input.status !== 'active' && input.status !== 'inactive') throw new Error('حالة البند غير صالحة.');
  return {
    id: input.id, projectId: Number(input.projectId), code: input.code.trim(), name: input.name.trim(),
    parentId, description: input.description.trim(), status: input.status,
  };
}

function workItemRows(database: DatabaseSync, projectId?: number): ProjectWorkItem[] {
  const rows = (projectId === undefined
    ? database.prepare(`SELECT items.*, projects.name AS project_name, parents.code AS parent_code, parents.name AS parent_name,
        (SELECT COUNT(*) FROM project_work_items AS children WHERE children.parent_id = items.id) AS child_count,
        (SELECT COUNT(*) FROM inventory_issue_lines WHERE work_item_id = items.id) AS usage_count
      FROM project_work_items AS items INNER JOIN projects ON projects.id = items.project_id
      LEFT JOIN project_work_items AS parents ON parents.id = items.parent_id
      ORDER BY items.code COLLATE NOCASE, items.id`).all()
    : database.prepare(`SELECT items.*, projects.name AS project_name, parents.code AS parent_code, parents.name AS parent_name,
        (SELECT COUNT(*) FROM project_work_items AS children WHERE children.parent_id = items.id) AS child_count,
        (SELECT COUNT(*) FROM inventory_issue_lines WHERE work_item_id = items.id) AS usage_count
      FROM project_work_items AS items INNER JOIN projects ON projects.id = items.project_id
      LEFT JOIN project_work_items AS parents ON parents.id = items.parent_id
      WHERE items.project_id = ? ORDER BY items.code COLLATE NOCASE, items.id`).all(projectId)) as Row[];
  return rows.map((row) => ({
    id: Number(row.id), projectId: Number(row.project_id), projectName: String(row.project_name),
    code: String(row.code), name: String(row.name), parentId: row.parent_id === null ? null : Number(row.parent_id),
    parentCode: String(row.parent_code ?? ''), parentName: String(row.parent_name ?? ''),
    description: String(row.description), status: String(row.status) as ProjectWorkItem['status'],
    childCount: Number(row.child_count), usageCount: Number(row.usage_count),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function registerProjectHandlers(requireDatabase: () => DatabaseSync): void {
  ipcMain.handle('projects:list', () => projectRows(requireDatabase()));
  ipcMain.handle('projects:save', (_event, value: unknown) => {
    const database = requireDatabase();
    const input = validateProject(value);
    const duplicate = database.prepare('SELECT 1 FROM projects WHERE code = ? COLLATE NOCASE AND (? IS NULL OR id <> ?) LIMIT 1')
      .get(input.code, input.id ?? null, input.id ?? null);
    if (duplicate) throw new Error('كود المشروع مستخدم بالفعل.');
    if (input.id !== undefined) {
      const current = database.prepare('SELECT code, name FROM projects WHERE id = ?').get(input.id) as Row | undefined;
      if (!current) throw new Error('المشروع المطلوب غير موجود.');
      if ((String(current.code) !== input.code || String(current.name) !== input.name)
        && database.prepare('SELECT 1 FROM inventory_issues WHERE project_id = ? LIMIT 1').get(input.id)) {
        throw new Error('لا يمكن تغيير كود أو اسم مشروع مرتبط بسند صرف تاريخي.');
      }
      const result = database.prepare(`UPDATE projects SET code = ?, name = ?, start_date = ?, end_date = ?,
        cost_center = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.code, input.name, input.startDate, input.endDate, input.costCenter, input.status, input.id);
      if (!result.changes) throw new Error('المشروع المطلوب غير موجود.');
      return projectRows(database).find((project) => project.id === input.id);
    }
    const result = database.prepare(`INSERT INTO projects (code, name, start_date, end_date, cost_center, status)
      VALUES (?, ?, ?, ?, ?, ?)`).run(input.code, input.name, input.startDate, input.endDate, input.costCenter, input.status);
    return projectRows(database).find((project) => project.id === Number(result.lastInsertRowid));
  });
  ipcMain.handle('projects:delete', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم المشروع غير صالح.');
    const projectId = Number(value);
    const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('المشروع المطلوب غير موجود.');
    if (database.prepare('SELECT 1 FROM inventory_issues WHERE project_id = ? LIMIT 1').get(projectId)) {
      throw new Error('لا يمكن حذف مشروع مرتبط بسندات صرف؛ يمكن تغيير حالته بدلًا من ذلك.');
    }
    if (database.prepare('SELECT 1 FROM project_work_items WHERE project_id = ? LIMIT 1').get(projectId)) {
      throw new Error('لا يمكن حذف مشروع يحتوي على بنود أعمال؛ احذف/عطّل البنود المرتبطة أولًا.');
    }
    database.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    return true;
  });
  ipcMain.handle('projects:work-items:list', (_event, value: unknown) => {
    const database = requireDatabase();
    if (value === null || value === undefined || value === '') return workItemRows(database);
    if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('رقم المشروع غير صالح.');
    return workItemRows(database, Number(value));
  });
  ipcMain.handle('projects:work-items:save', (_event, value: unknown) => {
    const database = requireDatabase();
    const input = validateWorkItem(value);
    const duplicate = database.prepare('SELECT 1 FROM project_work_items WHERE code = ? COLLATE NOCASE AND (? IS NULL OR id <> ?) LIMIT 1')
      .get(input.code, input.id ?? null, input.id ?? null);
    if (duplicate) throw new Error('كود بند الأعمال مستخدم بالفعل.');
    if (!database.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) throw new Error('المشروع المرتبط غير موجود.');
    if (input.id !== undefined && !database.prepare('SELECT 1 FROM project_work_items WHERE id = ?').get(input.id)) {
      throw new Error('بند الأعمال المطلوب تعديله غير موجود.');
    }
    if (input.id !== undefined) {
      const existing = database.prepare(`SELECT project_id, code, name, parent_id,
        (SELECT COUNT(*) FROM inventory_issue_lines WHERE work_item_id = project_work_items.id) AS usage_count,
        (SELECT COUNT(*) FROM project_work_items AS children WHERE children.parent_id = project_work_items.id) AS child_count
        FROM project_work_items WHERE id = ?`).get(input.id) as Row;
      const changed = Number(existing.project_id) !== input.projectId || String(existing.code) !== input.code
        || String(existing.name) !== input.name || (existing.parent_id === null ? null : Number(existing.parent_id)) !== input.parentId;
      if (changed && (Number(existing.usage_count) > 0 || Number(existing.child_count) > 0)) {
        throw new Error('لا يمكن تغيير كود أو اسم أو موقع بند مرتبط بحركات أو بنود فرعية؛ عدّل الوصف أو الحالة فقط.');
      }
    }
    if (input.parentId !== null) {
      const parent = database.prepare('SELECT id, project_id FROM project_work_items WHERE id = ?').get(input.parentId) as Row | undefined;
      if (!parent || Number(parent.project_id) !== input.projectId) throw new Error('اختر بندًا رئيسيًا من المشروع نفسه.');
      if (input.id !== undefined && Number(parent.id) === input.id) throw new Error('لا يمكن ربط البند بنفسه.');
      if (input.id !== undefined) {
        const descendant = database.prepare(`WITH RECURSIVE descendants(id) AS (
          SELECT id FROM project_work_items WHERE parent_id = ?
          UNION ALL SELECT child.id FROM project_work_items AS child INNER JOIN descendants ON child.parent_id = descendants.id
        ) SELECT 1 FROM descendants WHERE id = ? LIMIT 1`).get(input.id, input.parentId);
        if (descendant) throw new Error('لا يمكن نقل البند أسفل أحد فروعه.');
      }
    }
    let id: number;
    if (input.id !== undefined) {
      const result = database.prepare(`UPDATE project_work_items SET project_id = ?, code = ?, name = ?, parent_id = ?,
        description = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(input.projectId, input.code, input.name, input.parentId, input.description, input.status, input.id);
      if (!result.changes) throw new Error('بند الأعمال المطلوب غير موجود.');
      id = input.id;
    } else {
      id = Number(database.prepare(`INSERT INTO project_work_items (project_id, code, name, parent_id, description, status)
        VALUES (?, ?, ?, ?, ?, ?)`).run(input.projectId, input.code, input.name, input.parentId, input.description, input.status).lastInsertRowid);
    }
    return workItemRows(database, input.projectId).find((item) => item.id === id);
  });
  ipcMain.handle('projects:work-items:status', (_event, value: unknown) => {
    const database = requireDatabase();
    if (!value || typeof value !== 'object') throw new Error('طلب تحديث حالة بند الأعمال غير صالح.');
    const { id, status } = value as { id?: unknown; status?: unknown };
    if (!Number.isSafeInteger(id) || Number(id) < 1 || (status !== 'active' && status !== 'inactive')) {
      throw new Error('بيانات حالة بند الأعمال غير صالحة.');
    }
    const result = database.prepare("UPDATE project_work_items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, Number(id));
    if (!result.changes) throw new Error('بند الأعمال المطلوب غير موجود.');
    return workItemRows(database).find((item) => item.id === Number(id));
  });
}
