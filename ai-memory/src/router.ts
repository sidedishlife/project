// 하단 탭 4개 + 화면 등록 자리(Task 11이 registerView 로 끼워 넣음)
import { api } from './api';

export type Tab = 'review' | 'inbox' | 'notes' | 'settings';
export type ViewRender = (root: HTMLElement) => void | Promise<void>;

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'review', label: '복습', icon: '📖' },
  { id: 'inbox', label: '받은함', icon: '📥' },
  { id: 'notes', label: '노트', icon: '📝' },
  { id: 'settings', label: '설정', icon: '⚙️' },
];

const views = new Map<Tab, ViewRender>();
let current: Tab = 'review';
let content: HTMLElement | null = null;
let badge: HTMLElement | null = null;
let buttons = new Map<Tab, HTMLButtonElement>();

export function registerView(tab: Tab, render: ViewRender): void {
  views.set(tab, render);
}

function placeholder(label: string): ViewRender {
  return (root) => {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = `${label} 화면은 준비 중이에요`;
    root.append(p);
  };
}

export function currentTab(): Tab { return current; }

export async function refreshBadge(): Promise<void> {
  if (!badge) return;
  try {
    const { candidates } = await api<{ candidates: unknown[] }>('/inbox');
    const n = candidates.length;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
  } catch { /* 배지는 부가 정보: 실패해도 화면은 유지 */ }
}

export async function navigate(tab: Tab): Promise<void> {
  current = tab;
  for (const [id, b] of buttons) b.setAttribute('aria-current', id === tab ? 'page' : 'false');
  if (!content) return;
  content.replaceChildren();
  const render = views.get(tab) ?? placeholder(TABS.find((t) => t.id === tab)!.label);
  try {
    await render(content);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = e instanceof Error ? e.message : '화면을 불러오지 못했어요';
    content.replaceChildren(p);
  }
  void refreshBadge();
}

export function mountShell(app: HTMLElement): void {
  app.replaceChildren();
  content = document.createElement('main');
  content.className = 'view';
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  buttons = new Map();
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.innerHTML = `<span class="tab-icon" aria-hidden="true">${t.icon}</span><span class="tab-label">${t.label}</span>`;
    b.addEventListener('click', () => void navigate(t.id));
    if (t.id === 'inbox') {
      badge = document.createElement('span');
      badge.className = 'badge';
      badge.hidden = true;
      b.append(badge);
    }
    buttons.set(t.id, b);
    nav.append(b);
  }
  app.append(content, nav);
}
