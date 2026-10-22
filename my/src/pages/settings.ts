import type { BackupRecord, BackupState, CompanyProfile, GeneralSettings, ThemeMode } from '../shared/types.js';
import { escapeHtml } from '../utils/html.js';

export type SettingsView = 'general' | 'backup' | 'company' | 'users' | 'permission-groups' | 'user-permissions';

function tabs(active: SettingsView): string {
  const options: Array<[SettingsView, string]> = [
    ['general', 'الإعدادات العامة'], ['backup', 'النسخ الاحتياطي'], ['company', 'بيانات الشركة'],
    ['users', 'المستخدمون'], ['permission-groups', 'مجموعات الصلاحيات'], ['user-permissions', 'صلاحيات المستخدمين'],
  ];
  return `<nav class="settings-tabs" aria-label="صفحات الإعدادات">${options.map(([key, label]) =>
    `<button type="button" class="settings-tab ${active === key ? 'is-active' : ''}" data-settings-view="${key}" aria-current="${active === key ? 'page' : 'false'}">${label}</button>`,
  ).join('')}</nav>`;
}

function generalSettings(version: string, settings: GeneralSettings): string {
  return `<div class="settings-content">
    <section class="settings-card"><header><div><h3>المظهر والتشغيل</h3><p>إعدادات التطبيق الحالية المحفوظة على هذا الجهاز.</p></div></header>
      <form data-form="settings-general" class="settings-form settings-form--compact">
        <label class="field"><span>مظهر التطبيق</span><select name="theme"><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>فاتح</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>داكن</option></select><small>يُحفظ الاختيار ويُطبّق على كل صفحات النظام.</small></label>
        <label class="field"><span>بادئة أرقام الفواتير</span><input name="invoicePrefix" value="${escapeHtml(settings.invoicePrefix)}" maxlength="12" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,11}" required><small>تُستخدم للفواتير الجديدة فقط؛ تبقى الأرقام المسجلة دون تغيير.</small></label>
        <button class="button button--primary" type="submit">حفظ الإعدادات</button>
      </form>
      <div class="settings-info-grid">
        <article><span>إصدار التطبيق</span><strong>${escapeHtml(version)}</strong><small>رقم الإصدار المثبت</small></article>
        <article><span>التخزين</span><strong>SQLite محلي</strong><small>قاعدة البيانات ضمن مساحة بيانات التطبيق</small></article>
        <article><span>جلسة التطبيق</span><strong>نافذة واحدة</strong><small>تُمنع الجلسات المتزامنة</small></article>
      </div>
    </section>
    <section class="settings-card"><header><div><h3>الفواتير والحسابات والصلاحيات</h3><p>السياسات الفعلية الحالية؛ الحقول غير المعتمدة لا تُعرض كإعدادات قابلة للتغيير.</p></div></header>
      <div class="settings-policy-list">
        <article><strong>الضريبة والعملة</strong><p>لا توجد نسبة ضريبة عامة أو عملة قابلة للتغيير. بيانات ضريبة الصنف وصفية ولا تُطبق، والترحيل المالي للفواتير مؤجل حتى اعتماد قواعده. سندات الخزائن المعتمدة مقيدة حاليًا بـ EGP.</p></article>
        <article><strong>ترقيم المستندات</strong><p>بادئة الفاتورة قابلة للتخصيص وتُطبق على الفواتير الجديدة فقط؛ أرقام المقايسات وأوامر العمل والمستخلصات تحتفظ ببادئاتها الحالية.</p></article>
        <article><strong>الحسابات الافتراضية</strong><p>تُحدد الحسابات المرتبطة بكل عملية عند إدخالها؛ لا توجد خريطة حسابات افتراضية عامة مفعّلة.</p></article>
        <article><strong>تكلفة المخزون ومواد المشاريع</strong><p>تعتمد حركات الصرف متوسط تكلفة المخزن وقت الاعتماد، وينقل التحويل التكلفة نفسها. لا تغيّر هذه الصفحة سياسة التكلفة أو الحركات السابقة.</p></article>
        <article><strong>الملفات والصلاحيات</strong><p>تُحفظ البيانات محليًا، وتُجرى عمليات الملفات عبر نوافذ النظام. إدارة الحسابات ومجموعات الصلاحيات في صفحات إدارة الوصول.</p></article>
      </div>
    </section>
    <section class="settings-card settings-card--danger"><header><div><h3>إدارة بيانات البرنامج</h3><p>تفريغ معاملات التشغيل فقط؛ لا يحذف تعريفات النظام أو الحسابات أو المستخدمين.</p></div></header>
      <div class="data-reset-panel">
        <p><strong>ما سيُحذف:</strong> مستندات المبيعات والمشتريات والمخزون وحركاته، عقود ومعاملات العملاء والمقاولين، سندات القبض والصرف والمصروفات والقيود والإهلاكات والموازنات والسجلات العامة غير المرتبطة بسجل مشروع أو مقاول.</p>
        <p><strong>ما سيبقى:</strong> نسخة أمان تُنشأ تلقائيًا قبل التنفيذ، إعدادات البرنامج وبيانات الشركة، المستخدمون والمجموعات والصلاحيات وسجل النسخ، الحسابات ومراكز التكلفة، العملاء والموردون والأصناف والمشاريع والوحدات والمقاولون والمخازن والخزائن والبنوك والأصول، والأرصدة الافتتاحية. تُحفظ كذلك السجلات العامة المرتبطة بمشروع أو مقاول.</p>
        <p class="muted">لا يمكن التراجع عن التفريغ بعد إتمامه. يلزم حساب مدير النظام، وتأكيد العملية بكتابة العبارة المحددة.</p>
        <button class="button button--danger" type="button" data-action="program-data-reset">تفريغ بيانات التشغيل</button>
      </div>
    </section>
  </div>`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ar-EG');
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} بايت`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} كيلوبايت`;
  return `${(size / (1024 * 1024)).toFixed(2)} ميجابايت`;
}

function backupSettings(state: BackupState, selectedFile: { fileName: string; size: number; createdAt: string } | null): string {
  const lastSuccess = state.history.find((entry) => entry.status === 'success' && (entry.kind === 'automatic' || entry.kind === 'manual' || entry.kind === 'pre-restore'));
  const rows = state.history.length
    ? state.history.map((entry) => `<tr><td>${escapeHtml(formatDate(entry.date))}</td><td>${escapeHtml(entry.fileName || '—')}</td><td>${formatSize(entry.size)}</td><td><span class="backup-status backup-status--${entry.status}">${entry.status === 'success' ? 'ناجحة' : 'فاشلة'}</span></td><td>${escapeHtml(entry.message || (entry.kind === 'automatic' ? 'تلقائية' : entry.kind === 'pre-restore' ? 'نسخة أمان قبل الاستعادة' : 'يدوية'))}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty-state">لا يوجد سجل لعمليات النسخ أو الاستعادة بعد.</td></tr>';
  return `<div class="settings-content">
    <section class="settings-card"><header><div><h3>النسخ الاحتياطي</h3><p>نسخة SQLite متسقة تشمل قاعدة البيانات كاملة. النسخ التلقائي يعمل وفق الفترة المحددة ما دام التطبيق مفتوحًا.</p></div><button class="button button--secondary" type="button" data-action="backup-refresh">تحديث الحالة</button></header>
      <div class="backup-status-grid">
        <article><span>آخر نسخة ناجحة</span><strong>${lastSuccess ? escapeHtml(formatDate(lastSuccess.date)) : 'لا توجد نسخة'}</strong></article>
        <article><span>حجمها</span><strong>${lastSuccess ? formatSize(lastSuccess.size) : '—'}</strong></article>
        <article><span>مجلد النسخ</span><strong class="backup-path">${escapeHtml(state.preferences.directory)}</strong></article>
      </div>
      <form data-form="backup-settings" class="settings-form">
        <label class="field backup-directory-field"><span>مسار حفظ النسخ الاحتياطية</span><div class="backup-directory-control"><input name="directory" value="${escapeHtml(state.preferences.directory)}" readonly required><button class="button button--secondary" type="button" data-action="backup-choose-folder">اختيار مجلد</button></div></label>
        <label class="field"><span>النسخ التلقائي</span><select name="automatic"><option value="true" ${state.preferences.automatic ? 'selected' : ''}>مفعّل</option><option value="false" ${state.preferences.automatic ? '' : 'selected'}>متوقف</option></select></label>
        <label class="field"><span>الفترة بين النسخ (بالساعات)</span><input name="intervalHours" type="number" min="1" max="720" value="${state.preferences.intervalHours}" required></label>
        <label class="field"><span>عدد النسخ المحتفظ بها</span><input name="retentionCount" type="number" min="1" max="100" value="${state.preferences.retentionCount}" required></label>
        <div class="settings-form-actions"><button class="button button--primary" type="submit">حفظ إعدادات النسخ</button><button class="button button--secondary" type="button" data-action="backup-now">نسخ احتياطي الآن</button><button class="button button--secondary" type="button" data-action="backup-open-folder">فتح مجلد النسخ</button></div>
        <p class="form-error settings-inline-error" role="alert" hidden></p>
      </form>
    </section>
    <section class="settings-card"><header><div><h3>استعادة نسخة احتياطية</h3><p>يُتحقق من سلامة قاعدة البيانات قبل الاستعادة، وتُنشأ نسخة أمان من البيانات الحالية أولًا.</p></div></header>
      <div class="restore-controls"><button class="button button--secondary" type="button" data-action="backup-choose-restore">اختيار ملف نسخة</button>
        <div class="restore-file" data-restore-file>${selectedFile ? `<strong>${escapeHtml(selectedFile.fileName)}</strong><span>${formatSize(selectedFile.size)} · ${escapeHtml(formatDate(selectedFile.createdAt))}</span><span class="backup-status backup-status--success">ملف صالح للاستعادة</span>` : '<span>لم يتم اختيار ملف</span>'}</div>
        <button class="button button--danger" type="button" data-action="backup-restore" ${selectedFile ? '' : 'disabled'}>استعادة النسخة المحددة</button>
      </div>
    </section>
    <section class="settings-card"><header><div><h3>سجل النسخ والاستعادة</h3><p>يعرض آخر 100 عملية ونتيجتها، بما فيها رسالة الفشل عند حدوثها.</p></div></header>
      <div class="table-scroll"><table class="settings-history-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>الحجم</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
  </div>`;
}

function companySettings(company: CompanyProfile): string {
  const field = (name: keyof CompanyProfile, label: string, value: string, options = '') =>
    `<label class="field"><span>${label}</span><input name="${name}" value="${escapeHtml(value)}" ${options}></label>`;
  return `<div class="settings-content">
    <section class="settings-card"><header><div><h3>بيانات الشركة</h3><p>تُحفظ محليًا ويُستخدم اسم الشركة العربي في ترويسة التقارير.</p></div></header>
      <form data-form="company-profile" class="company-form">
        ${field('nameAr', 'اسم الشركة بالعربية *', company.nameAr, 'required maxlength="180"')}
        ${field('nameEn', 'اسم الشركة بالإنجليزية', company.nameEn, 'maxlength="180"')}
        ${field('phone', 'رقم الهاتف', company.phone, 'maxlength="60"')}
        ${field('email', 'البريد الإلكتروني', company.email, 'type="email" maxlength="180"')}
        ${field('commercialRegister', 'السجل التجاري', company.commercialRegister, 'maxlength="100"')}
        ${field('taxNumber', 'الرقم الضريبي', company.taxNumber, 'maxlength="100"')}
        <label class="field company-form__wide"><span>العنوان بالعربية</span><textarea name="addressAr" maxlength="500" rows="2">${escapeHtml(company.addressAr)}</textarea></label>
        <label class="field company-form__wide"><span>العنوان بالإنجليزية</span><textarea name="addressEn" maxlength="500" rows="2" dir="ltr">${escapeHtml(company.addressEn)}</textarea></label>
        <section class="company-logo company-form__wide"><div><h4>شعار الشركة</h4><p>PNG أو JPEG أو WebP، حتى 5 ميجابايت.</p>
          <input type="file" accept="image/png,image/jpeg,image/webp" data-company-logo hidden>
          <button class="button button--secondary" type="button" data-action="company-logo-choose">رفع أو تغيير الشعار</button>
        </div><div class="company-logo-preview">${company.logoDataUrl ? `<img src="${escapeHtml(company.logoDataUrl)}" alt="شعار الشركة الحالي">` : '<span>لا يوجد شعار</span>'}</div></section>
        <p class="form-error settings-inline-error company-form__wide" role="alert" hidden></p>
        <div class="settings-form-actions company-form__wide"><button class="button button--primary" type="submit">حفظ بيانات الشركة</button><button class="button button--secondary" type="reset">إلغاء التعديلات</button></div>
      </form>
    </section>
  </div>`;
}

export function renderSettings(version: string, view: SettingsView, settings: GeneralSettings, backup: BackupState, company: CompanyProfile, selectedRestore: { fileName: string; size: number; createdAt: string } | null, contentOverride?: string): string {
  const content = contentOverride ?? (view === 'backup' ? backupSettings(backup, selectedRestore)
    : view === 'company' ? companySettings(company)
      : view === 'users' || view === 'permission-groups' || view === 'user-permissions'
        ? '<section class="notice-panel notice-panel--warning" role="alert">تعذر تحميل تبويب الإعدادات المطلوب.</section>'
        : generalSettings(version, settings));
  return `<section class="settings-page">
    <header class="section-heading section-heading--page"><div><p class="eyebrow">النظام</p><h2>الإعدادات</h2><p class="muted">إدارة إعدادات هذا التثبيت المحلي وبيانات المنشأة.</p></div></header>
    ${tabs(view)}
    ${content}
  </section>`;
}
