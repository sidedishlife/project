// 게임 규칙: 레벨(노력, 떨어지지 않음) + 도감 등급(기억 단계, 잊으면 내려감) + 오늘의 퀘스트
import { MASTERED_STAGE } from '../supabase/functions/api/srs';

// ── 경험치
export const XP = {
  create: 20, // 새 표현 저장
  loop: 10, // 반복 듣기 끝까지
  good: 10, hard: 5, again: 2, // 복습 채점
  comboBonus: 2, // 연속 정답 1회당 추가 (최대 +10)
  allDone: 30, // 그날 복습 전부 끝내기
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
export interface Day { date: string; reviewed: number; created: number; loops: number; allDone: boolean; claimed: string[]; firstStudy: boolean }
export const emptyDay = (date: string): Day => ({ date, reviewed: 0, created: 0, loops: 0, allDone: false, claimed: [], firstStudy: false });

export interface Quest { id: string; label: string; goal: number; xp: number; progress: (d: Day) => number }
export const QUESTS: Quest[] = [
  { id: 'review', label: '모험 완료: 복습 모두 끝내기', goal: 1, xp: 30, progress: (d) => (d.allDone ? 1 : 0) },
  { id: 'create', label: '새 주문 2개 배우기', goal: 2, xp: 30, progress: (d) => d.created },
  { id: 'loop', label: '반복 듣기 끝까지 1번', goal: 1, xp: 20, progress: (d) => d.loops },
];
