// 다크 모드: 'auto'(시스템) | 'light' | 'dark'. aim_theme 에 저장, <html data-theme> 로 적용
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'aim_theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}
export function applyTheme(t: Theme = getTheme()): void {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
}
