import type { Card, Settings, Stats } from './types';

const K = { cards: 'ee.cards', stats: 'ee.stats', settings: 'ee.settings' };

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 공간 부족 등 */ }
}

export function loadCards(): Card[] {
  try {
    const v = localStorage.getItem(K.cards);
    return v ? (JSON.parse(v) as Card[]) : [];
  } catch {
    return [];
  }
}
export const saveCards = (cards: Card[]) => write(K.cards, cards);

export const loadStats = (): Stats => read(K.stats, { xp: 0, streak: 0, lastStudyDay: '', bestCombo: 0 });
export const saveStats = (s: Stats) => write(K.stats, s);

export const loadSettings = (): Settings => read(K.settings, { apiKey: '', rate: 0.9, listenTarget: 20 });
export const saveSettings = (s: Settings) => write(K.settings, s);

export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 오늘 처음 공부하면 연속 학습일(streak)을 갱신 */
export function touchStreak(s: Stats): Stats {
  const t = today();
  if (s.lastStudyDay === t) return s;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const streak = s.lastStudyDay === today(y) ? s.streak + 1 : 1;
  return { ...s, streak, lastStudyDay: t };
}

export function exportBackup(): string {
  return JSON.stringify({ cards: loadCards(), stats: loadStats() }, null, 2);
}
export function importBackup(json: string) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.cards)) throw new Error('올바른 백업 파일이 아닙니다');
  saveCards(data.cards);
  if (data.stats) saveStats(data.stats);
}
