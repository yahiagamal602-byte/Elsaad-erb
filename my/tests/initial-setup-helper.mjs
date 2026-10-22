export async function completeInitialSetup(evaluate) {
  const setupRequired = await evaluate(`Boolean(document.querySelector('[data-form="initial-setup"]'))`);
  if (!setupRequired) return;

  await evaluate(`(() => {
    const form = document.querySelector('[data-form="initial-setup"]');
    const password = form?.querySelector('[name="password"]');
    const confirmation = form?.querySelector('[name="confirmPassword"]');
    if (!form || !password || !confirmation) throw new Error('Initial setup form is incomplete.');
    password.value = 'E2e#SecurePassword2026';
    confirmation.value = 'E2e#SecurePassword2026';
    form.querySelector('button[type="submit"]')?.click();
    return true;
  })()`);
  await evaluate(`new Promise((resolve, reject) => {
    if (document.querySelector('.app-shell')) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector('.app-shell')) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Initial setup did not open the application.')); }, 15000);
  })`);
  await evaluate(`document.querySelector('[data-action="logout"]')?.click()`);
  await evaluate(`new Promise((resolve, reject) => {
    if (document.querySelector('#login-form')) return resolve(true);
    const observer = new MutationObserver(() => {
      if (document.querySelector('#login-form')) { observer.disconnect(); clearTimeout(timer); resolve(true); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Login form did not appear after setup.')); }, 15000);
  })`);
}
