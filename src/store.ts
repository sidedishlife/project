import type { Card, Settings, Stats } from './types';

const K = { cards: 'ee.cards', stats: 'ee.stats', settings: 'ee.settings', dead: 'ee.deleted' };

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

const emptyDay = (date = today()) => ({ date, correct: 0, created: 0, loops: 0, claimed: [] as string[] });
export const loadStats = (): Stats => fixStats(read<Stats>(K.stats, {} as Stats));

/** 예전 버전 데이터나 빠진 항목을 채우고, 날짜가 바뀌면 오늘 기록을 새로 시작 */
export function fixStats(s: Partial<Stats>): Stats {
  const day = s.day && s.day.date === today() ? s.day : emptyDay();
  return {
    xp: s.xp ?? 0,
    streak: s.streak ?? 0,
    lastStudyDay: s.lastStudyDay ?? '',
    bestCombo: s.bestCombo ?? 0,
    day: { ...emptyDay(), ...day },
    totals: { created: 0, correct: 0, listens: 0, perfect: 0, ...(s.totals ?? {}) },
    badges: s.badges ?? [],
  };
}
export const saveStats = (s: Stats) => write(K.stats, s);

export const loadSettings = (): Settings => read(K.settings, { apiKey: '', rate: 0.9, listenTarget: 20, sound: true });
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

/** 지운 카드 id 목록: 다른 기기 기록과 합칠 때 되살아나지 않게 */
export function loadTombstones(): string[] {
  try { return JSON.parse(localStorage.getItem(K.dead) || '[]'); } catch { return []; }
}
export function addTombstone(id: string) {
  write(K.dead, [...loadTombstones(), id].slice(-500));
}

/** 브라우저가 저장 공간을 임의로 비우지 않도록 요청 (지원되는 곳만) */
export function requestPersistentStorage() {
  try { void navigator.storage?.persist?.(); } catch { /* 미지원 */ }
}
