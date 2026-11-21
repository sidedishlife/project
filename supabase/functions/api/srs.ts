// 망각곡선(간격 반복) 계산. 서버가 유일한 기준이라 기기마다 결과가 달라지지 않는다.
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** 단계별 다음 복습까지 간격: 10분 → 1일 → 3일 → 1주 → 2주 → 1달 → 2달 → 4달(마스터) */
export const INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 120 * DAY];
export const MASTERED_STAGE = INTERVALS.length - 1;

export type Grade = 'again' | 'hard' | 'good';

export interface SrsState {
  stage: number;
  reviews: number;
  lapses: number;
}

/** 채점 결과 → 새 단계와 다음 복습 시각 */
export function schedule(s: SrsState, grade: Grade, now = Date.now()): SrsState & { due: number } {
  const next = { ...s, reviews: s.reviews + 1, due: now };
  if (grade === 'again') {
    // 잊었다 = 기억 곡선 처음부터
    next.stage = 0;
    next.lapses += 1;
    next.due = now + INTERVALS[0];
  } else if (grade === 'hard') {
    // 헷갈렸다 = 단계 유지, 간격 절반
    next.due = now + Math.max(INTERVALS[0], INTERVALS[s.stage] / 2);
  } else {
    next.stage = Math.min(s.stage + 1, MASTERED_STAGE);
    next.due = now + INTERVALS[next.stage];
  }
  return next;
}

/** 새 카드: 10분 뒤 첫 복습 */
export const firstDue = (now = Date.now()) => now + INTERVALS[0];

// ── 20회 듣기를 복습 간격에 나눠서
export const LISTEN_TARGET = 20;
export const FIRST_LISTENS = 5;
/** 이번 복습에서 들을 횟수: 남은 횟수를 남은 단계에 고르게 나눔 (최소 2회) */
export function listensThisReview(listens: number, stage: number): number {
  const left = Math.max(0, LISTEN_TARGET - listens);
  if (left === 0) return 1; // 다 채운 뒤에도 복습 때 한 번은 들음
  const stagesLeft = Math.max(1, MASTERED_STAGE - stage);
  return Math.min(left, Math.max(2, Math.ceil(left / stagesLeft)));
}
