import type { Card, Stats } from './types';
import { fixStats } from './store';

const stamp = (c: Card) => c.updatedAt ?? c.createdAt;

/**
 * 이 기기 기록과 계정 기록을 합친다. 어느 쪽 기록도 버리지 않는다.
 * - 같은 카드는 더 최근에 바뀐 쪽 (같으면 복습을 더 많이 한 쪽)
 * - 지운 카드(tombstones)는 되살리지 않음
 * 반환: 합친 카드, 계정에 올려야 할 카드
 */
export function mergeCards(local: Card[], remote: Card[], tombstones: string[] = []) {
  const dead = new Set(tombstones);
  const map = new Map<string, Card>();
  for (const c of remote) if (!dead.has(c.id)) map.set(c.id, c);
  const toUpload: Card[] = [];
  for (const c of local) {
    if (dead.has(c.id)) continue;
    const r = map.get(c.id);
    if (!r || stamp(c) > stamp(r) || (stamp(c) === stamp(r) && c.reviews > r.reviews)) {
      map.set(c.id, c);
      toUpload.push(c);
    }
  }
  const merged = [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
  return { merged, toUpload };
}

/** 통계는 줄어들지 않게: 숫자는 큰 값, 배지는 합집합 */
export function mergeStats(a: Partial<Stats>, b: Partial<Stats>): Stats {
  const x = fixStats(a);
  const y = fixStats(b);
  const newer = x.lastStudyDay >= y.lastStudyDay ? x : y;
  const max = (k: 'created' | 'correct' | 'listens' | 'perfect') => Math.max(x.totals[k], y.totals[k]);
  return {
    xp: Math.max(x.xp, y.xp),
    streak: newer.streak,
    lastStudyDay: newer.lastStudyDay,
    bestCombo: Math.max(x.bestCombo, y.bestCombo),
    day: {
      date: x.day.date,
      correct: Math.max(x.day.correct, y.day.correct),
      created: Math.max(x.day.created, y.day.created),
      loops: Math.max(x.day.loops, y.day.loops),
      claimed: [...new Set([...x.day.claimed, ...y.day.claimed])],
    },
    totals: { created: max('created'), correct: max('correct'), listens: max('listens'), perfect: max('perfect') },
    badges: [...new Set([...x.badges, ...y.badges])],
  };
}
