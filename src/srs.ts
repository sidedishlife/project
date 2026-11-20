import type { Card } from './types';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/**
 * 에빙하우스 망각곡선을 반영한 복습 간격.
 * 기억이 급격히 사라지는 초기에는 촘촘하게, 기억이 굳을수록 간격을 넓힌다.
 * stage 0: 10분 → 1일 → 3일 → 7일 → 14일 → 30일 → 60일 → 120일
 */
export const INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 120 * DAY];
export const MASTERED_STAGE = INTERVALS.length - 1;

export type Grade = 'again' | 'hard' | 'good';

export function schedule(card: Card, grade: Grade, now = Date.now()): Card {
  const c = { ...card, reviews: card.reviews + 1 };
  if (grade === 'again') {
    // 잊었다 = 기억 곡선 처음부터 다시
    c.stage = 0;
    c.lapses += 1;
    c.due = now + INTERVALS[0];
  } else if (grade === 'hard') {
    // 헷갈렸다 = 단계 유지, 같은 간격으로 한 번 더
    c.due = now + Math.max(INTERVALS[0], INTERVALS[c.stage] / 2);
  } else {
    c.stage = Math.min(c.stage + 1, MASTERED_STAGE);
    c.due = now + INTERVALS[c.stage];
  }
  return c;
}

export function isDue(card: Card, now = Date.now()): boolean {
  return card.due <= now;
}

export function newCardSchedule(now = Date.now()): Pick<Card, 'stage' | 'due' | 'listens' | 'reviews' | 'lapses'> {
  return { stage: 0, due: now + INTERVALS[0], listens: 0, reviews: 0, lapses: 0 };
}

export function formatDue(card: Card, now = Date.now()): string {
  const d = card.due - now;
  if (d <= 0) return '지금 복습';
  if (d < 60 * MIN) return `${Math.ceil(d / MIN)}분 후`;
  if (d < DAY) return `${Math.ceil(d / (60 * MIN))}시간 후`;
  return `${Math.ceil(d / DAY)}일 후`;
}

export const STAGE_LABELS = ['새싹', '1일', '3일', '1주', '2주', '1달', '2달', '마스터'];
