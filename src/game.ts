// 게임 규칙: 레벨(노력, 떨어지지 않음) + 도감 등급(기억 단계, 잊으면 내려감) + 오늘의 퀘스트
import { MASTERED_STAGE } from '../supabase/functions/api/srs';

// ── 경험치
export const XP = {
  create: 20, // 새 표현 저장
  loop: 10, // 반복 듣기 끝까지
  good: 10, hard: 5, again: 2, // 복습 채점
  comboBonus: 2, // 연속 정답 1회당 추가 (최대 +10)
  speak: 5, // 말해서 공격 성공 (80점 이상)
  perfect: 5, // 95점 이상 추가
  streakPerDay: 5, streakMax: 50, // 연속 공부일 보너스 (하루 첫 공부 때)
};

/** 레벨 n → n+1 에 필요한 경험치 */
export const needFor = (n: number) => Math.round(80 * Math.pow(n, 1.4));

/** 누적 경험치 → 레벨, 이번 레벨에서 모은 양, 필요한 양 */
export function levelOf(xp: number) {
  let lv = 1, rest = xp;
  while (rest >= needFor(lv) && lv < 99) { rest -= needFor(lv); lv++; }
  return { lv, cur: rest, need: needFor(lv) };
}

// ── 지역과 칭호 (레벨 구간)
export interface Region { from: number; name: string; title: string; sky: [string, string]; ground: [string, string]; feature: 'village' | 'forest' | 'harbor' | 'castle' | 'kingdom' }
export const REGIONS: Region[] = [
  { from: 1, name: '시작의 마을', title: '견습 모험가', sky: ['#8fd3ff', '#d9f2ff'], ground: ['#9bd56b', '#6fb24a'], feature: 'village' },
  { from: 5, name: '초록 숲', title: '여행자', sky: ['#7cc8a8', '#d4f0dc'], ground: ['#5fa54a', '#3f7f35'], feature: 'forest' },
  { from: 10, name: '바닷가 항구', title: '항해사', sky: ['#66b8f0', '#cfeaff'], ground: ['#e8cf96', '#c9a865'], feature: 'harbor' },
  { from: 15, name: '하늘 성', title: '기사', sky: ['#a99cf0', '#e6e0ff'], ground: ['#9aa4c4', '#6f7aa0'], feature: 'castle' },
  { from: 20, name: '영어 왕국', title: '영어 마스터', sky: ['#f7b36b', '#ffe6c2'], ground: ['#d6a35c', '#a8773a'], feature: 'kingdom' },
];
export const regionOf = (lv: number) => [...REGIONS].reverse().find((r) => lv >= r.from)!;

// ── 도감 등급 (카드의 기억 단계 0~7)
export interface Tier { key: string; name: string; icon: string; color: string }
const TIERS: Tier[] = [
  { key: 'sprout', name: '새싹', icon: '🌱', color: '#7bc96f' },
  { key: 'bronze', name: '브론즈', icon: '🥉', color: '#c98a4b' },
  { key: 'silver', name: '실버', icon: '🥈', color: '#a9b4c2' },
  { key: 'gold', name: '골드', icon: '🥇', color: '#f2c14e' },
  { key: 'diamond', name: '다이아', icon: '💎', color: '#6fd3f2' },
  { key: 'master', name: '마스터', icon: '👑', color: '#c77dff' },
];
/** 단계 0 새싹, 1 브론즈, 2~3 실버, 4~5 골드, 6 다이아, 7 마스터 */
export function tierOf(stage: number): Tier {
  if (stage >= MASTERED_STAGE) return TIERS[5];
  if (stage >= 6) return TIERS[4];
  if (stage >= 4) return TIERS[3];
  if (stage >= 2) return TIERS[2];
  if (stage >= 1) return TIERS[1];
  return TIERS[0];
}
export const ALL_TIERS = TIERS;

// ── 오늘의 퀘스트
export interface Day { date: string; reviewed: number; created: number; loops: number; spoken: number; allDone: boolean; claimed: string[]; firstStudy: boolean }
export const emptyDay = (date: string): Day => ({ date, reviewed: 0, created: 0, loops: 0, spoken: 0, allDone: false, claimed: [], firstStudy: false });

/** go: 누르면 이동할 곳 */
export interface Quest { id: string; icon: string; label: string; goal: number; xp: number; go: 'review' | 'create' | 'speak'; progress: (d: Day) => number }
export const QUESTS: Quest[] = [
  { id: 'review', icon: '⚔️', label: '오늘의 몬스터 모두 물리치기', goal: 1, xp: 30, go: 'review', progress: (d) => (d.allDone ? 1 : 0) },
  { id: 'speak', icon: '🎙️', label: '말해서 공격 3번 성공', goal: 3, xp: 30, go: 'speak', progress: (d) => d.spoken ?? 0 },
  { id: 'create', icon: '✨', label: '새 주문 2개 배우기', goal: 2, xp: 30, go: 'create', progress: (d) => d.created },
  { id: 'loop', icon: '🔁', label: '반복 듣기 끝까지 1번', goal: 1, xp: 20, go: 'create', progress: (d) => d.loops },
];

// ── 누적 기록과 업적
export interface Totals { spoken: number; perfect: number; reviewed: number; created: number }
export const emptyTotals = (): Totals => ({ spoken: 0, perfect: 0, reviewed: 0, created: 0 });
export interface Ctx { cards: number; mastered: number; gold: number; streak: number; combo: number; t: Totals }
export interface Badge { id: string; icon: string; name: string; desc: string; xp: number; done: (c: Ctx) => boolean; now: (c: Ctx) => number; goal: number }
const B = (id: string, icon: string, name: string, desc: string, goal: number, now: (c: Ctx) => number, xp = 50): Badge => ({ id, icon, name, desc, xp, goal, now, done: (c) => now(c) >= goal });
export const BADGES: Badge[] = [
  B('first', '📜', '첫 주문', '주문 1개 배우기', 1, (c) => c.cards, 30),
  B('cards10', '📚', '주문 수집가', '주문 10개 배우기', 10, (c) => c.cards),
  B('cards50', '🏛️', '주문 도서관', '주문 50개 배우기', 50, (c) => c.cards, 150),
  B('cards100', '🌟', '대마법사의 서재', '주문 100개 배우기', 100, (c) => c.cards, 300),
  B('speak1', '🎙️', '첫 외침', '말해서 공격 1번 성공', 1, (c) => c.t.spoken, 30),
  B('speak50', '🗣️', '유창한 마법사', '말해서 공격 50번 성공', 50, (c) => c.t.spoken, 150),
  B('perfect10', '🎯', '완벽한 발음', '95점 이상 10번', 10, (c) => c.t.perfect, 100),
  B('gold1', '🥇', '황금 주문', '골드 등급 주문 1개', 1, (c) => c.gold),
  B('master1', '👑', '첫 마스터', '마스터 주문 1개 (4달 기억)', 1, (c) => c.mastered, 200),
  B('streak3', '🔥', '사흘 연속', '3일 연속 공부', 3, (c) => c.streak, 30),
  B('streak7', '☄️', '일주일 연속', '7일 연속 공부', 7, (c) => c.streak, 100),
  B('streak30', '🌋', '한 달 연속', '30일 연속 공부', 30, (c) => c.streak, 300),
  B('combo10', '⚡', '10 콤보', '연속 정답 10번', 10, (c) => c.combo, 100),
];

