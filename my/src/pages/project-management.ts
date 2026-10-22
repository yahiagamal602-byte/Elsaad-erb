import type {
  InventoryIssue,
  InventoryItem,
  InventoryStockBalance,
  Project,
  ProjectStatus,
  ProjectWorkItem,
  Warehouse,
} from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

const statusLabels: Record<ProjectStatus, string> = {
  new: 'جديد',
  'in-progress': 'قيد التنفيذ',
  'on-hold': 'متوقف',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

function projectOptions(projects: Project[], selected = 0): string {
  return projects.map((project) => `<option value="${project.id}" ${project.id === selected ? 'selected' : ''}>
    ${escapeHtml(`${project.code} — ${project.name}`)}</option>`).join('');
}

function statusBadge(status: string, label: string): string {
  return `<span class="project-status project-status--${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function projectStats(projects: Project[]): string {
  const count = (status: ProjectStatus) => projects.filter((project) => project.status === status).length;
  return `<div class="project-stat-grid">
    <article class="project-stat"><span>إجمالي المشاريع</span><strong>${projects.length}</strong></article>
    <article class="project-stat"><span>جديد</span><strong>${count('new')}</strong></article>
    <article class="project-stat"><span>قيد التنفيذ</span><strong>${count('in-progress')}</strong></article>
    <article class="project-stat"><span>متوقف</span><strong>${count('on-hold')}</strong></article>
    <article class="project-stat"><span>مكتمل</span><strong>${count('completed')}</strong></article>
    <article class="project-stat"><span>ملغي</span><strong>${count('cancelled')}</strong></article>
  </div>`;
}

export function renderProjectsPage(projects: Project[]): string {
  const rows = projects.map((project, index) => `<tr data-project-row data-status="${project.status}"
    data-search="${escapeHtml(`${project.code} ${project.name} ${project.costCenter}`.toLocaleLowerCase('ar'))}">
    <td>${index + 1}</td><td><strong>${escapeHtml(project.code)}</strong></td><td>${escapeHtml(project.name)}</td>
    <td>${escapeHtml(project.startDate || 'غير محدد')}</td><td>${escapeHtml(project.endDate || '—')}</td>
    <td>${project.durationDays === null ? '—' : `${project.durationDays} يوم`}</td>
    <td>${escapeHtml(project.costCenter || '—')}</td><td>${statusBadge(project.status, statusLabels[project.status])}</td>
    <td class="project-row-actions">
      <button class="button button--tiny button--secondary" data-action="project-units" data-id="${project.id}" type="button">وحدات المشروع</button>
      <button class="button button--tiny button--secondary" data-action="project-edit" data-id="${project.id}" type="button">تعديل</button>
      <button class="button button--tiny button--danger" data-action="project-delete" data-id="${project.id}" type="button">حذف</button>
    </td></tr>`).join('');
  return `<section class="project-page">
    <div class="project-toolbar"><div><p class="eyebrow">إدارة المشاريع</p><h1>المشاريع</h1>
      <p class="muted">بيانات المشاريع ومراكز التكلفة والحالة. لا تعرض هذه الصفحة قيمًا مالية غير مرتبطة.</p></div>
      <div class="project-toolbar__actions"><button class="button button--primary" data-action="project-add" type="button">＋ مشروع جديد</button>
        <button class="button button--secondary" data-action="project-refresh" type="button">تحديث</button></div></div>
    ${projectStats(projects)}
    <section class="panel project-panel"><div class="project-filterbar">
      <label class="field"><span>بحث بالكود أو الاسم</span><input id="project-search" type="search" placeholder="ابحث عن مشروع"></label>
      <label class="field"><span>حالة المشروع</span><select id="project-status-filter"><option value="">كل الحالات</option>
        ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
      </select></label></div>
      <div class="table-scroll"><table class="project-table"><thead><tr><th>#</th><th>الكود</th><th>اسم المشروع</th>
        <th>البداية</th><th>النهاية</th><th>المدة</th><th>مركز التكلفة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody id="project-rows">${rows || '<tr><td colspan="9" class="empty-state">لا توجد مشاريع. أضف مشروعًا للبدء.</td></tr>'}</tbody></table></div>
      <div class="project-table-footer"><span id="project-result-count">عدد المشاريع: ${projects.length}</span>
        <div><button class="button button--tiny button--secondary" data-action="project-page" data-step="-1" type="button">السابق</button>
        <span id="project-page-label">1 / 1</span>
        <button class="button button--tiny button--secondary" data-action="project-page" data-step="1" type="button">التالي</button></div></div>
    </section><div id="project-modal-host"></div></section>`;
}

export function renderProjectForm(project: Project | null): string {
  const startDate = project ? project.startDate : new Date().toISOString().slice(0, 10);
  return `<div class="modal-backdrop" id="project-modal"><section class="modal-card project-modal-card" role="dialog" aria-modal="true">
    <header class="modal-card__header"><div><p class="eyebrow">بيانات المشروع</p><h2>${project ? 'تعديل المشروع' : 'مشروع جديد'}</h2></div>
      <button class="icon-button" data-action="project-close" type="button" aria-label="إغلاق">×</button></header>
    <form data-form="project" class="project-form"><input type="hidden" name="id" value="${project?.id ?? ''}">
      <div class="project-form-grid">
        <label class="field"><span>كود المشروع *</span><input name="code" maxlength="40" required value="${escapeHtml(project?.code ?? '')}"></label>
        <label class="field"><span>اسم المشروع *</span><input name="name" maxlength="180" required value="${escapeHtml(project?.name ?? '')}"></label>
        <label class="field"><span>تاريخ البداية *</span><input name="startDate" type="date" required value="${escapeHtml(startDate)}"></label>
        <label class="field"><span>تاريخ النهاية</span><input name="endDate" type="date" value="${escapeHtml(project?.endDate ?? '')}"></label>
        <label class="field"><span>المدة المحسوبة</span><input id="project-duration" readonly value="${project?.durationDays === null || project?.durationDays === undefined ? 'أدخل تاريخ النهاية' : `${project.durationDays} يوم`}"></label>
        <label class="field"><span>مركز التكلفة</span><input name="costCenter" maxlength="160" value="${escapeHtml(project?.costCenter ?? '')}"></label>
        <label class="field"><span>حالة المشروع</span><select name="status">
          ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${project?.status === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
      </div><p class="form-error" id="project-error" role="alert" hidden></p>
      <footer class="modal-card__footer"><button class="button button--quiet" data-action="project-close" type="button">إغلاق</button>
        <button class="button button--primary" type="submit">حفظ المشروع</button></footer>
    </form></section></div>`;
}

function workItemSelect(items: ProjectWorkItem[], projectId: number, selectedId: number | null, selfId?: number): string {
  return `<select name="parentId"><option value="">بند رئيسي</option>${items.filter((item) =>
    item.projectId === projectId && item.id !== selfId && item.status === 'active').map((item) =>
    `<option value="${item.id}" ${selectedId === item.id ? 'selected' : ''}>${escapeHtml(`${item.code} — ${item.name}`)}</option>`).join('')}</select>`;
}

function workItemTree(items: ProjectWorkItem[], selectedProjectId: number | null): string {
  const children = new Map<number | null, ProjectWorkItem[]>();
  for (const item of items) {
    const parent = item.parentId;
    const branch = children.get(parent) ?? [];
    branch.push(item);
    children.set(parent, branch);
  }
  const renderBranch = (parentId: number | null, visited: Set<number>): string => (children.get(parentId) ?? []).map((item) => {
    if (visited.has(item.id)) return '';
    const descendants = new Set(visited).add(item.id);
    const childMarkup = renderBranch(item.id, descendants);
    const haystack = `${item.code} ${item.name} ${item.projectName}`.toLocaleLowerCase('ar');
    return `<li data-tree-node data-id="${item.id}" data-project-id="${item.projectId}" ${selectedProjectId !== null && selectedProjectId !== item.projectId ? 'hidden' : ''}><div class="work-tree-row" data-work-item-row data-search="${escapeHtml(haystack)}">
      ${childMarkup ? '<button class="work-tree-toggle" data-action="work-tree-node-toggle" type="button" aria-expanded="true">−</button>' : '<span class="work-tree-branch">•</span>'}
      <button class="work-tree-name" data-action="work-item-edit" data-id="${item.id}" type="button">
        <strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.name)}</span></button>
      ${statusBadge(item.status, item.status === 'active' ? 'نشط' : 'غير نشط')}
      <button class="button button--tiny button--secondary" data-action="work-item-edit" data-id="${item.id}" type="button">تعديل</button>
    </div>${childMarkup ? `<ul data-tree-children>${childMarkup}</ul>` : ''}</li>`;
  }).join('');
  return renderBranch(null, new Set()) || '<li class="empty-state">لا توجد بنود أعمال بعد.</li>';
}

export function renderWorkItemsPage(projects: Project[], items: ProjectWorkItem[], selectedProjectId: number | null): string {
  const active = items.filter((item) => item.status === 'active').length;
  const rootCount = items.filter((item) => item.parentId === null).length;
  return `<section class="project-page">
    <div class="project-toolbar"><div><p class="eyebrow">هيكل نطاق الأعمال</p><h1>بنود الأعمال</h1>
      <p class="muted">شجرة مرجعية لربط تكاليف المواد بالمشروع؛ لا تنشئ قيودًا مالية.</p></div>
      <div class="project-toolbar__actions"><button class="button button--primary" data-action="work-item-add" type="button">＋ بند جديد</button>
        <button class="button button--secondary" data-action="work-tree-expand" type="button">توسيع الكل</button>
        <button class="button button--secondary" data-action="work-tree-collapse" type="button">طي الكل</button></div></div>
    <div class="project-stat-grid project-stat-grid--four">
      <article class="project-stat"><span>إجمالي البنود</span><strong>${items.length}</strong></article>
      <article class="project-stat"><span>البنود الرئيسية</span><strong>${rootCount}</strong></article>
      <article class="project-stat"><span>البنود النشطة</span><strong>${active}</strong></article>
      <article class="project-stat"><span>البنود غير النشطة</span><strong>${items.length - active}</strong></article>
    </div>
    <div class="work-item-layout"><section class="panel work-item-editor"><header class="panel-heading"><div><p class="eyebrow">قسم بيانات البند</p><h2 id="work-item-form-title">بند جديد</h2></div></header>
      <form data-form="work-item" id="work-item-form">
        <input type="hidden" name="id"><label class="field"><span>المشروع *</span><select name="projectId" required>
          <option value="">اختر المشروع</option>${projectOptions(projects, selectedProjectId ?? 0)}</select></label>
        <label class="field"><span>كود البند *</span><input name="code" maxlength="40" required></label>
        <label class="field"><span>اسم البند *</span><input name="name" maxlength="180" required></label>
        <label class="field"><span>البند الرئيسي</span><span id="work-item-parent-host">${workItemSelect(items, selectedProjectId ?? 0, null)}</span></label>
        <label class="field"><span>الوصف</span><textarea name="description" rows="3" maxlength="2000"></textarea></label>
        <label class="field"><span>الحالة</span><select name="status"><option value="active">نشط</option><option value="inactive">غير نشط</option></select></label>
        <p class="form-error" id="work-item-error" role="alert" hidden></p>
        <div class="project-form-actions"><button class="button button--primary" type="submit">حفظ البند</button>
          <button class="button button--quiet" data-action="work-item-reset" type="button">جديد</button>
          <button class="button button--secondary" data-action="work-item-toggle" type="button" disabled>تعطيل</button></div>
      </form></section>
      <section class="panel work-item-tree-panel"><header class="panel-heading"><div><p class="eyebrow">شجرة بنود الأعمال</p><h2>البنود</h2></div>
        <div class="work-tree-filters"><label class="field"><span>المشروع</span><select id="work-item-project-filter">
          <option value="">كل المشاريع</option>${projectOptions(projects, selectedProjectId ?? 0)}</select></label>
          <label class="field work-tree-search"><span>بحث بالكود أو الاسم</span><input id="work-item-search" type="search"></label></div></header>
        <div class="work-tree" id="work-item-tree"><ul>${workItemTree(items, selectedProjectId)}</ul></div></section></div>
  </section>`;
}

function itemOptions(items: InventoryItem[], selectedId?: number): string {
  return `<option value="">اختر المادة</option>${items.filter((item) => item.status === 'active' || item.id === selectedId).map((item) =>
    `<option value="${item.id}" data-unit-id="${item.baseUnitId}" data-unit-name="${escapeHtml(item.baseUnitName)}"
      ${selectedId === item.id ? 'selected' : ''}>${escapeHtml(`${item.code} — ${item.nameAr}`)}</option>`).join('')}`;
}

export function projectIssueLine(
  items: InventoryItem[],
  workItems: ProjectWorkItem[],
  projectId: number,
  issueLine?: InventoryIssue['lines'][number],
): string {
  const selectedWorkItem = issueLine?.workItemId ?? null;
  const workOptions = workItems.filter((item) => item.projectId === projectId && (item.status === 'active' || item.id === selectedWorkItem))
    .map((item) => `<option value="${item.id}" ${item.id === selectedWorkItem ? 'selected' : ''}>${escapeHtml(`${item.code} — ${item.name}`)}</option>`).join('');
  return `<tr data-project-issue-line><td><select name="itemId" required>${itemOptions(items, issueLine?.itemId)}</select>
    <small class="project-line-unit">${escapeHtml(issueLine?.unitName ?? '—')}</small></td>
    <td><select name="workItemId" required><option value="">اختر بند الأعمال</option>${workOptions}</select></td>
    <td data-available>${escapeHtml(issueLine?.availableQuantity ?? '0')}</td>
    <td><input name="quantity" type="number" min="0.000000000001" step="0.000000000001" required value="${escapeHtml(issueLine?.quantity ?? '')}"></td>
    <td data-unit-cost>${escapeHtml(issueLine?.unitCost ?? '0')}</td><td data-line-cost>0</td>
    <td><button class="button button--tiny button--danger" type="button" data-action="project-issue-line-delete">حذف</button></td>
    <input type="hidden" name="unitId" value="${issueLine?.unitId ?? ''}"></tr>`;
}

export function renderProjectIssueForm(
  issue: InventoryIssue | null,
  projects: Project[],
  workItems: ProjectWorkItem[],
  items: InventoryItem[],
  warehouses: Warehouse[],
  balances: InventoryStockBalance[],
): string {
  const selectedProjectId = issue?.projectId ?? projects.find((item) => item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'on-hold')?.id ?? 0;
  const rows = issue?.lines.length ? issue.lines.map((line) => projectIssueLine(items, workItems, selectedProjectId, line)).join('')
    : projectIssueLine(items, workItems, selectedProjectId);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const itemCatalog = JSON.stringify(items.filter((item) => item.status === 'active').map((item) => ({
    id: item.id, unitId: item.baseUnitId, unitName: item.baseUnitName,
  }))).replaceAll('<', '\\u003c');
  const balanceCatalog = JSON.stringify(balances.map((balance) => ({
    itemId: balance.itemId, warehouseId: balance.warehouseId, quantity: balance.quantity, unitCost: balance.unitCost,
  }))).replaceAll('<', '\\u003c');
  return `<div class="modal-backdrop" id="project-issue-modal"><section class="modal-card project-issue-modal" role="dialog" aria-modal="true">
    <header class="modal-card__header"><div><p class="eyebrow">${issue ? 'مستند محفوظ' : 'صرف مواد للاستخدام بالمشروع'}</p>
      <h2>${issue ? `سند ${escapeHtml(issue.number)}` : 'سند صرف مواد مشروع جديد'}</h2></div>
      <button class="icon-button" data-action="project-issue-close" type="button" aria-label="إغلاق">×</button></header>
    ${issue ? `<div class="project-issue-state">${statusBadge(issue.status, issue.status === 'draft' ? 'مسودة' : issue.status === 'approved' ? 'معتمد' : 'ملغي')}
      <span>تاريخ الإنشاء: ${escapeHtml(issue.createdAt)}</span></div>` : ''}
    <form data-form="project-issue" data-items="${escapeHtml(itemCatalog)}" data-balances="${escapeHtml(balanceCatalog)}"
      data-readonly="${issue && issue.status !== 'draft' ? 'true' : 'false'}">
      <input type="hidden" name="id" value="${issue?.id ?? ''}">
      <div class="project-form-grid project-issue-head">
        <label class="field"><span>رقم السند</span><input readonly value="${escapeHtml(issue?.number ?? 'يُنشأ تلقائيًا عند الحفظ')}"></label>
        <label class="field"><span>المشروع *</span><select name="projectId" required ${issue?.status !== 'draft' && issue ? 'disabled' : ''}>
          <option value="">اختر المشروع</option>${projectOptions(projects, selectedProjectId)}</select></label>
        <label class="field"><span>مركز التكلفة</span><input name="costCenter" readonly value="${escapeHtml(issue?.costCenter ?? selectedProject?.costCenter ?? '')}"></label>
        <label class="field"><span>المخزن *</span><select name="warehouseId" required ${issue?.status !== 'draft' && issue ? 'disabled' : ''}>
          <option value="">اختر المخزن</option>${warehouses.filter((warehouse) => warehouse.status === 'active').map((warehouse) =>
            `<option value="${warehouse.id}" ${issue?.warehouseId === warehouse.id ? 'selected' : ''}>${escapeHtml(`${warehouse.code} — ${warehouse.name}`)}</option>`).join('')}</select></label>
        <label class="field"><span>تاريخ الصرف *</span><input name="date" type="date" required value="${escapeHtml(issue?.date ?? new Date().toISOString().slice(0, 10))}"></label>
        <label class="field"><span>سبب الصرف / الجهة *</span><input name="reason" maxlength="240" required value="${escapeHtml(issue?.reason ?? 'صرف مواد للمشروع')}"></label>
        <label class="field project-issue-notes"><span>ملاحظات</span><input name="notes" maxlength="2000" value="${escapeHtml(issue?.notes ?? '')}"></label>
      </div>
      <div class="project-issue-lines-heading"><h3>تفاصيل المواد</h3>${issue?.status === 'draft' || !issue
        ? '<button class="button button--secondary" type="button" data-action="project-issue-line-add">＋ إضافة مادة</button>' : ''}</div>
      <div class="table-scroll"><table class="project-table project-issue-lines"><thead><tr><th>المادة والوحدة الأساسية</th>
        <th>بند الأعمال</th><th>المتاح</th><th>الكمية</th><th>متوسط التكلفة</th><th>تكلفة الصرف</th><th></th></tr></thead>
        <tbody id="project-issue-lines">${rows}</tbody><tfoot><tr><th colspan="3">الإجمالي</th><td id="project-issue-quantity">0</td>
          <td></td><td id="project-issue-total">0</td><td></td></tr></tfoot></table></div>
      <p class="muted">لا يتم خصم المخزون إلا عند الاعتماد. التكلفة المرجعية تُستخرج من متوسط تكلفة المخزن عند الاعتماد.</p>
      <p class="form-error" id="project-issue-error" role="alert" hidden></p>
      ${issue ? `<footer class="modal-card__footer">
        ${issue.status === 'draft' ? `<button class="button button--quiet" data-action="project-issue-close" type="button">إغلاق</button>
          <button class="button button--primary" type="submit">حفظ المسودة</button>
          <button class="button button--confirm" data-action="project-issue-approve" data-id="${issue.id}" type="button">اعتماد وخصم المخزون</button>
          <button class="button button--danger" data-action="project-issue-cancel" data-id="${issue.id}" type="button">إلغاء</button>
          <button class="button button--danger" data-action="project-issue-delete" data-id="${issue.id}" type="button">حذف المسودة</button>`
          : `<button class="button button--quiet" data-action="project-issue-close" type="button">إغلاق</button>
            ${issue.status === 'approved' ? `<button class="button button--danger" data-action="project-issue-cancel" data-id="${issue.id}" type="button">إلغاء بعكس الحركة</button>` : ''}
            <button class="button button--secondary" data-action="project-issue-print" data-id="${issue.id}" type="button">طباعة</button>`}
      </footer>` : `<footer class="modal-card__footer"><button class="button button--quiet" data-action="project-issue-close" type="button">إغلاق</button>
        <button class="button button--primary" type="submit">حفظ كمسودة</button></footer>`}
    </form></section></div>`;
}

export function renderProjectMaterialsPage(
  projects: Project[],
  issues: InventoryIssue[],
  workItems: ProjectWorkItem[],
  items: InventoryItem[],
  warehouses: Warehouse[],
  balances: InventoryStockBalance[],
): string {
  const projectIssues = issues.filter((issue) => issue.issueType === 'project');
  const drafts = projectIssues.filter((issue) => issue.status === 'draft').length;
  const approved = projectIssues.filter((issue) => issue.status === 'approved').length;
  const rows = projectIssues.map((issue) => `<tr data-project-issue-row data-search="${escapeHtml(
    `${issue.number} ${issue.projectName} ${issue.projectCode} ${issue.warehouseName} ${issue.reason}`.toLocaleLowerCase('ar'))}">
    <td><strong>${escapeHtml(issue.number)}</strong></td><td>${escapeHtml(issue.projectName || '—')}</td>
    <td>${escapeHtml(issue.warehouseName)}</td><td>${escapeHtml(issue.date)}</td><td>${escapeHtml(issue.totalQuantity)}</td>
    <td>${escapeHtml(issue.totalCost)}</td><td>${statusBadge(issue.status, issue.status === 'draft' ? 'مسودة' : issue.status === 'approved' ? 'معتمد' : 'ملغي')}</td>
    <td><button class="button button--tiny button--secondary" data-action="project-issue-view" data-id="${issue.id}" type="button">عرض</button>
      ${issue.status === 'draft' ? `<button class="button button--tiny button--confirm" data-action="project-issue-approve" data-id="${issue.id}" type="button">اعتماد</button>` : ''}
      ${issue.status === 'approved' ? `<button class="button button--tiny button--secondary" data-action="project-issue-print" data-id="${issue.id}" type="button">طباعة</button>` : ''}
    </td></tr>`).join('');
  return `<section class="project-page">
    <div class="project-toolbar"><div><p class="eyebrow">حركة مخزون مرتبطة بالمشاريع</p><h1>صرف مواد المشاريع</h1>
      <p class="muted">صرف داخلي مرتبط بمشروع وبند أعمال؛ يعتمد على سجل المخزون الموحد.</p></div>
      <div class="project-toolbar__actions"><button class="button button--primary" data-action="project-issue-add" type="button">＋ سند صرف جديد</button>
        <button class="button button--secondary" data-action="project-issue-refresh" type="button">تحديث</button>
        <button class="button button--secondary" data-action="project-issue-print-list" type="button">طباعة القائمة</button></div></div>
    <div class="project-stat-grid project-stat-grid--four">
      <article class="project-stat"><span>إجمالي السندات</span><strong>${projectIssues.length}</strong></article>
      <article class="project-stat"><span>مسودات</span><strong>${drafts}</strong></article>
      <article class="project-stat"><span>معتمدة</span><strong>${approved}</strong></article>
      <article class="project-stat"><span>أرصدة صنف/مخزن</span><strong>${balances.length}</strong><small>صفوف رصيد من دفتر الحركات</small></article>
    </div>
    <section class="panel project-panel"><div class="project-filterbar"><label class="field"><span>بحث برقم السند أو المشروع</span>
      <input id="project-issue-search" type="search" placeholder="ابحث"></label></div>
      <div class="table-scroll"><table class="project-table"><thead><tr><th>رقم السند</th><th>المشروع</th><th>المخزن</th>
        <th>التاريخ</th><th>إجمالي الكمية</th><th>التكلفة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty-state">لا توجد سندات صرف مواد للمشاريع.</td></tr>'}</tbody></table></div>
    </section><div id="project-issue-modal-host" data-project-count="${projects.length}" data-work-item-count="${workItems.length}"
      data-item-count="${items.length}" data-warehouse-count="${warehouses.length}"></div></section>`;
}

export function renderProjectIssuePrint(issue: InventoryIssue): string {
  const rows = issue.lines.map((line) => `<tr><td>${escapeHtml(line.itemCode)}</td><td>${escapeHtml(line.itemName)}</td>
    <td>${escapeHtml(line.workItemCode ? `${line.workItemCode} — ${line.workItemName}` : '—')}</td>
    <td>${escapeHtml(line.unitName)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.unitCost)}</td>
    <td>${escapeHtml(line.totalCost)}</td></tr>`).join('');
  return `<article class="project-issue-print" dir="rtl"><header><h1>Elsaad ERP — سند صرف مواد مشروع</h1>
    <strong>${escapeHtml(issue.number)}</strong></header><div class="project-print-meta">
    <span>المشروع: ${escapeHtml(issue.projectCode)} — ${escapeHtml(issue.projectName)}</span>
    <span>مركز التكلفة: ${escapeHtml(issue.costCenter || '—')}</span><span>المخزن: ${escapeHtml(issue.warehouseName)}</span>
    <span>التاريخ: ${escapeHtml(issue.date)}</span><span>سبب الصرف: ${escapeHtml(issue.reason)}</span></div>
    <table><thead><tr><th>الكود</th><th>المادة</th><th>بند الأعمال</th><th>الوحدة</th><th>الكمية</th><th>تكلفة الوحدة</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr><th colspan="4">الإجمالي</th><td>${escapeHtml(issue.totalQuantity)}</td><td></td><td>${escapeHtml(issue.totalCost)}</td></tr></tfoot></table>
    <p>الحالة: ${escapeHtml(issue.status === 'approved' ? 'معتمد' : issue.status === 'cancelled' ? 'ملغي' : 'مسودة')}</p>
    ${issue.notes ? `<p>ملاحظات: ${escapeHtml(issue.notes)}</p>` : ''}</article>`;
}
