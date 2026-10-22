import type {
  ManagedUser, PermissionDefinition, PermissionGroup, PermissionOperation, UserPermissionState,
} from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

const operationOrder: PermissionOperation[] = ['view', 'create', 'edit', 'delete', 'approve', 'export'];

function userRows(users: ManagedUser[], selectedId: number | null): string {
  return users.length ? users.map((user) => `<tr class="${selectedId === user.id ? 'is-selected' : ''}" data-user-row="${user.id}">
    <td><button class="user-select-button" type="button" data-action="user-select" data-id="${user.id}">${escapeHtml(user.username)}</button></td>
    <td>${escapeHtml(user.fullName)}</td><td>${escapeHtml(user.groupName || '—')}</td>
    <td><span class="status-badge ${user.active ? 'status-badge--active' : 'status-badge--inactive'}">${user.active ? 'نشط' : 'موقوف'}</span></td>
    <td>${user.systemAdmin ? 'مدير' : 'عادي'}</td><td>${escapeHtml(user.lastLoginAt || 'لم يسجل الدخول بعد')}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty-state">لا توجد نتائج مطابقة.</td></tr>';
}

export function renderUsersPage(users: ManagedUser[], groups: PermissionGroup[], selectedId: number | null): string {
  const selected = users.find(({ id }) => id === selectedId) ?? null;
  const groupOptions = groups.filter(({ active }) => active).map((group) =>
    `<option value="${group.id}" ${selected?.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
  return `<section class="admin-page">
    <header class="section-heading section-heading--page"><div><p class="eyebrow">إدارة الوصول</p><h2>المستخدمون</h2><p class="muted">حسابات محلية مرتبطة بمجموعات وصلاحيات فعلية.</p></div></header>
    <section class="settings-card"><header><div><h3>قائمة المستخدمين</h3><p>${users.length} حسابًا محليًا</p></div><div class="admin-actions">
      <button class="button button--secondary" type="button" data-action="users-refresh">تحديث</button>
      <button class="button button--primary" type="button" data-action="users-new">جديد</button>
      <button class="button button--secondary" type="button" data-action="users-open-rights" ${selected ? `data-id="${selected.id}"` : 'disabled'}>الصلاحيات</button>
      <button class="button button--quiet" type="button" data-action="users-exit">خروج</button>
    </div></header>
      <label class="field admin-search"><span>بحث بالاسم أو اسم الدخول</span><input type="search" data-user-search placeholder="اكتب للبحث" value=""></label>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>اسم المستخدم</th><th>الاسم الكامل</th><th>مجموعة الصلاحيات</th><th>الحالة</th><th>نوع الحساب</th><th>آخر دخول</th></tr></thead>
      <tbody>${userRows(users, selected?.id ?? null)}</tbody></table></div>
    </section>
    <section class="settings-card"><header><div><h3>${selected ? 'بيانات المستخدم' : 'مستخدم جديد'}</h3><p>كلمات المرور لا تُعرض بعد حفظها، وتُخزن بتجزئة مملحة.</p></div>
      ${selected ? `<button class="button ${selected.active ? 'button--danger' : 'button--secondary'}" type="button" data-action="user-toggle-active" data-id="${selected.id}" data-active="${!selected.active}">${selected.active ? 'إيقاف المستخدم' : 'إعادة التفعيل'}</button>` : ''}
    </header>
      <form class="settings-form user-form" data-form="managed-user">
        <input type="hidden" name="id" value="${selected?.id ?? ''}">
        <label class="field"><span>اسم المستخدم</span><input name="username" maxlength="60" required value="${escapeHtml(selected?.username ?? '')}" autocomplete="off"></label>
        <label class="field"><span>الاسم الكامل</span><input name="fullName" maxlength="180" required value="${escapeHtml(selected?.fullName ?? '')}"></label>
        <label class="field"><span>البريد الإلكتروني</span><input name="email" type="email" maxlength="254" value="${escapeHtml(selected?.email ?? '')}"></label>
        <label class="field"><span>رقم الهاتف</span><input name="phone" maxlength="40" value="${escapeHtml(selected?.phone ?? '')}"></label>
        <label class="field"><span>مجموعة الصلاحيات</span><select name="groupId"><option value="">${selected?.systemAdmin ? 'مدير النظام' : 'اختر مجموعة'}</option>${groupOptions}</select></label>
        <label class="field"><span>كلمة المرور ${selected ? '(اتركها فارغة للإبقاء عليها)' : ''}</span><input name="password" type="password" minlength="12" ${selected ? '' : 'required'} autocomplete="new-password"></label>
        <label class="field"><span>تأكيد كلمة المرور</span><input name="confirmPassword" type="password" autocomplete="new-password" ${selected ? '' : 'required'}></label>
        <label class="field"><span>حالة المستخدم</span><select name="active"><option value="true" ${!selected || selected.active ? 'selected' : ''}>نشط</option><option value="false" ${selected && !selected.active ? 'selected' : ''}>موقوف</option></select></label>
        <label class="field"><span>مدير النظام</span><select name="systemAdmin"><option value="false" ${!selected?.systemAdmin ? 'selected' : ''}>لا</option><option value="true" ${selected?.systemAdmin ? 'selected' : ''}>نعم — صلاحية إدارية كاملة</option></select></label>
        <label class="field user-form__wide"><span>ملاحظات</span><textarea name="notes" maxlength="2000">${escapeHtml(selected?.notes ?? '')}</textarea></label>
        <div class="settings-form-actions user-form__wide"><button class="button button--primary" type="submit">حفظ المستخدم</button><p class="form-error" data-user-error role="alert" hidden></p></div>
      </form>
    </section>
  </section>`;
}

function permissionMatrix(definitions: PermissionDefinition[], checked: Set<string>, inherited?: Set<string>, overrides?: Record<string, boolean>): string {
  const modules = [...new Set(definitions.map(({ module }) => module))];
  return modules.map((module) => {
    const permissions = definitions.filter((permission) => permission.module === module);
    return `<section class="permission-module"><h4>${escapeHtml(permissions[0]?.moduleLabel ?? module)}</h4><div class="permission-grid">
      ${operationOrder.flatMap((operation) => permissions.filter((permission) => permission.operation === operation).map((permission) => {
        const isInherited = inherited?.has(permission.key) ?? false;
        const direct = overrides && Object.prototype.hasOwnProperty.call(overrides, permission.key);
        return `<label class="permission-choice">
          <input type="checkbox" name="permission" value="${escapeHtml(permission.key)}" ${checked.has(permission.key) ? 'checked' : ''}
            data-inherited="${isInherited}" ${permission.module === 'settings' ? 'disabled' : ''}>
          <span>${escapeHtml(permission.label)}</span>
          ${inherited ? `<small>${direct ? 'مخصصة مباشرة' : isInherited ? 'موروثة من المجموعة' : 'غير ممنوحة'}</small>` : ''}
        </label>`;
      })).join('')}
    </div></section>`;
  }).join('');
}

export function renderPermissionGroupsPage(groups: PermissionGroup[], definitions: PermissionDefinition[], selectedId: number | null): string {
  const selected = groups.find(({ id }) => id === selectedId) ?? null;
  return `<section class="admin-page">
    <header class="section-heading section-heading--page"><div><p class="eyebrow">إدارة الوصول</p><h2>مجموعات الصلاحيات</h2><p class="muted">عرّف الصلاحيات التشغيلية المشتركة دون صلاحيات إدارة المستخدمين أو الإعدادات الحساسة.</p></div></header>
    <section class="settings-card"><header><div><h3>المجموعات</h3></div><div class="admin-actions">
      <label class="field"><span>بحث</span><input type="search" data-group-search></label>
      <button class="button button--secondary" type="button" data-action="groups-refresh">تحديث</button>
      <button class="button button--primary" type="button" data-action="groups-new">مجموعة جديدة</button>
    </div></header>
      <div class="group-list">${groups.length ? groups.map((group) => `<button type="button" class="group-list-item ${selected?.id === group.id ? 'is-selected' : ''}" data-action="group-select" data-id="${group.id}">
        <strong>${escapeHtml(group.name)}</strong><span>${group.active ? 'مفعّلة' : 'موقوفة'} · ${group.permissions.length} صلاحية</span></button>`).join('') : '<p class="empty-state">لا توجد مجموعات.</p>'}</div>
    </section>
    <form class="settings-card" data-form="permission-group"><header><div><h3>${selected ? 'تعديل المجموعة' : 'إنشاء مجموعة'}</h3><p>المجموعة الإدارية الافتراضية محمية.</p></div></header>
      <div class="settings-form">
        <input type="hidden" name="id" value="${selected?.id ?? ''}">
        <label class="field"><span>اسم المجموعة</span><input name="name" maxlength="100" required value="${escapeHtml(selected?.name ?? '')}" ${selected?.id === 1 ? 'readonly' : ''}></label>
        <label class="field"><span>الحالة</span><select name="active" ${selected?.id === 1 ? 'disabled' : ''}><option value="true" ${!selected || selected.active ? 'selected' : ''}>مفعّلة</option><option value="false" ${selected && !selected.active ? 'selected' : ''}>موقوفة</option></select></label>
        <label class="field user-form__wide"><span>وصف المجموعة</span><input name="description" maxlength="500" value="${escapeHtml(selected?.description ?? '')}"></label>
        <div class="settings-form-actions user-form__wide">
          <button class="button button--secondary" type="button" data-action="group-select-all">تحديد الكل</button>
          <button class="button button--secondary" type="button" data-action="group-clear-all">إلغاء الكل</button>
          <button class="button button--primary" type="submit" ${selected?.id === 1 ? 'disabled' : ''}>حفظ المجموعة</button>
          <p class="form-error" data-group-error role="alert" hidden></p>
        </div>
      </div>
      <div class="permission-matrix">${permissionMatrix(definitions, new Set(selected?.permissions ?? []))}</div>
    </form>
  </section>`;
}

export function renderUserPermissionsPage(users: ManagedUser[], selected: UserPermissionState | null, definitions: PermissionDefinition[]): string {
  return `<section class="admin-page">
    <header class="section-heading section-heading--page"><div><p class="eyebrow">إدارة الوصول</p><h2>صلاحيات المستخدمين</h2><p class="muted">تظهر الصلاحيات الموروثة والمخصصة والصلاحيات النهائية كلٌ على حدة.</p></div></header>
    <section class="settings-card"><header><div><h3>اختيار المستخدم</h3></div><div class="admin-actions">
      <label class="field"><span>بحث</span><input type="search" data-permission-user-search></label>
      <select data-permission-user aria-label="المستخدم">${users.map((user) => `<option value="${user.id}" ${selected?.user.id === user.id ? 'selected' : ''}>${escapeHtml(user.fullName)} (${escapeHtml(user.username)})</option>`).join('')}</select>
      <button class="button button--secondary" type="button" data-action="permissions-refresh">تحديث</button>
      ${selected && !selected.user.systemAdmin ? '<button class="button button--secondary" type="button" data-action="permissions-reset">استعادة الافتراضي</button>' : ''}
      ${selected && !selected.user.systemAdmin ? '<button class="button button--secondary" type="button" data-action="permissions-select-all">تحديد التشغيلية</button>' : ''}
      ${selected && !selected.user.systemAdmin ? '<button class="button button--secondary" type="button" data-action="permissions-clear-all">إلغاء التشغيلية</button>' : ''}
      <button class="button button--quiet" type="button" data-action="users-exit">خروج</button>
    </div></header>
    ${selected ? `<div class="permission-user-summary"><strong>${escapeHtml(selected.user.fullName)}</strong><span>${escapeHtml(selected.user.username)}</span><span>المجموعة: ${escapeHtml(selected.user.groupName || 'بدون مجموعة')}</span><span>${selected.user.systemAdmin ? 'مدير النظام (كامل الصلاحيات)' : `نهائيًا: ${selected.effective.length} صلاحية`}</span></div>
    <form data-form="user-permissions">
      <input type="hidden" name="userId" value="${selected.user.id}">
      <div class="permission-legend"><span>موروثة: تأتي من المجموعة</span><span>مخصصة: تغيير مباشر للمستخدم</span><span>النهائية: الصلاحيات الفعلية</span></div>
      <div class="permission-matrix">${permissionMatrix(definitions, new Set(selected.effective), new Set(selected.inherited), selected.overrides)}</div>
      <div class="settings-form-actions"><button class="button button--primary" type="submit" ${selected.user.systemAdmin ? 'disabled' : ''}>حفظ الصلاحيات</button><p class="form-error" data-permission-error role="alert" hidden></p></div>
    </form>` : '<p class="empty-state">لا يوجد مستخدم متاح لتخصيص صلاحياته.</p>'}
    </section>
  </section>`;
}
