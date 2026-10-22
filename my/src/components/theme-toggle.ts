import type { ThemeMode } from '../shared/types.js';

export function renderThemeToggle(theme: ThemeMode, className = ''): string {
  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const label = nextTheme === 'dark' ? 'التبديل إلى المظهر الداكن' : 'التبديل إلى المظهر الفاتح';

  return `
    <button class="theme-toggle ${className}" type="button" data-action="theme-toggle" aria-label="${label}" title="${label}">
      <svg class="theme-toggle__sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3.8"></circle>
        <path d="M12 2.5v2M12 19.5v2M4.1 4.1l1.4 1.4m13 13 1.4 1.4M2.5 12h2m15 0h2M4.1 19.9l1.4-1.4m13-13 1.4-1.4"></path>
      </svg>
      <svg class="theme-toggle__moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M19.2 15.4A8 8 0 0 1 8.6 4.8 8.3 8.3 0 1 0 19.2 15.4Z"></path>
        <path d="m16.9 4.5.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4.4-1.2Z"></path>
      </svg>
    </button>
  `;
}
