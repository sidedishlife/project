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
export interface Ctx { cards: number; mastered: number; gold: number; silver: number; streak: number; combo: number; t: Totals }
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


// ── 이야기: 지역마다 안내 인물, 도착 대사, 상황별 대사, 장(章)의 임무
// 세계관: '망각의 안개'가 퍼져 사람들이 잊은 말이 몬스터가 됨. 주문(영어 표현)을 모으고, 잊기 전에 불러내고, 소리 내어 외쳐 안개를 걷어 냄
export interface Chapter {
  no: number; npc: string; img: string; place: string;
  arrive: string[]; // 처음 도착했을 때 대화
  due: (n: number) => string; idle: string; empty: string; // 마을 대화창
  mission: { label: string; goal: number; now: (c: Ctx) => number; xp: number; go: 'create' | 'review' | 'speak' | 'list' };
}
export const CHAPTERS: Record<Region['feature'], Chapter> = {
  village: {
    no: 1, npc: '엘라 선생님', img: 'npc-teacher', place: '마을',
    arrive: [
      '어서 오렴, 꼬마 마법사. 요즘 마을에 <b>망각의 안개</b>가 퍼지고 있단다.',
      '사람들이 잊어버린 말이 <b>몬스터</b>가 되어 떠돌고 있지. 막을 방법은 하나뿐이야.',
      '<b>영어 주문을 모으고</b>, 잊기 전에 <b>다시 불러내고</b>, <b>소리 내어 외치는 것</b>!',
      '먼저 주문 5개를 배워 오렴. 그러면 숲으로 가는 길을 알려 주마.',
    ],
    due: (n) => `망각 몬스터가 <b>${n}마리</b> 나타났단다! 주문을 잊기 전에 물리치렴.`,
    idle: '안개가 잠잠하구나. 이럴 때 새 주문을 배워 두면 좋단다.',
    empty: '첫 주문을 배워 볼까? 영어로 하고 싶은 말을 한국어로 알려 주렴.',
    mission: { label: '주문 5개 배우기', goal: 5, now: (c) => c.cards, xp: 100, go: 'create' },
  },
  forest: {
    no: 2, npc: '숲지기 실바', img: 'npc-ranger', place: '숲',
    arrive: [
      '여기서부턴 숲이야. 안개가 짙어서 배운 주문도 금방 잊어버리기 쉬워.',
      '한 번 외운 주문은 <b>일주일</b>은 버텨야 진짜 네 것이 되지.',
      '주문 3개를 <b>🥈실버 등급</b>까지 키워 봐. 그럼 바닷가 항구로 안내해 줄게!',
    ],
    due: (n) => `숲속에 망각 몬스터 <b>${n}마리</b>! 놓치면 다시 처음부터야.`,
    idle: '조용하네. 오늘 배운 주문을 소리 내어 한 번 더 외쳐 볼래?',
    empty: '숲에서도 주문 수집은 계속돼. 새 주문을 배워 봐!',
    mission: { label: '주문 3개를 🥈실버 이상으로', goal: 3, now: (c) => c.silver, xp: 150, go: 'review' },
  },
  harbor: {
    no: 3, npc: '브릭 선장', img: 'npc-captain', place: '항구',
    arrive: [
      '하하! 머리로만 외운 주문으로는 바다를 못 건넌다!',
      '배를 띄우려면 주문을 <b>입 밖으로 크게</b> 외쳐야 하지.',
      '<b>말해서 공격 20번</b> 성공하면 하늘 성까지 태워 주마!',
    ],
    due: (n) => `갑판에 망각 몬스터 <b>${n}마리</b>! 주문을 외쳐서 쫓아내라!`,
    idle: '바람이 좋군. 도감에서 주문 하나 골라 큰 소리로 외쳐 봐라!',
    empty: '항해엔 주문이 많을수록 좋지. 새 주문을 배워 와라!',
    mission: { label: '말해서 공격 20번 성공', goal: 20, now: (c) => c.t.spoken, xp: 200, go: 'speak' },
  },
  castle: {
    no: 4, npc: '기사단장 레온', img: 'npc-knight', place: '하늘 성',
    arrive: [
      '하늘 성에 온 것을 환영하오, 마법사.',
      '진정한 기사는 하루도 수련을 거르지 않소. 기억은 매일 쌓아야 단단해지는 법.',
      '<b>7일 연속</b>으로 모험을 이어 가면, 왕국으로 가는 문을 열어 주겠소.',
    ],
    due: (n) => `성벽에 망각 몬스터 <b>${n}마리</b>가 접근 중이오!`,
    idle: '오늘의 수련은 마쳤소? 연속 기록을 지키는 것이 기사의 길이오.',
    empty: '새 주문을 익히는 것도 수련이오.',
    mission: { label: '7일 연속 공부', goal: 7, now: (c) => c.streak, xp: 250, go: 'review' },
  },
  kingdom: {
    no: 5, npc: '아리아 여왕', img: 'npc-queen', place: '왕국',
    arrive: [
      '드디어 오셨군요, 마법사님. 왕국을 대표해 감사드려요.',
      '안개를 완전히 걷어 내려면 <b>넉 달이 지나도 잊히지 않는 주문</b>이 필요해요.',
      '<b>👑마스터 주문</b>을 완성해 왕국을 지켜 주세요.',
    ],
    due: (n) => `왕국에 망각 몬스터 <b>${n}마리</b>가 나타났어요. 부탁드려요!`,
    idle: '평화로운 하루예요. 주문 도서관을 더 채워 볼까요?',
    empty: '왕국의 도서관에 새 주문을 더해 주세요.',
    mission: { label: '👑 마스터 주문 1개 완성', goal: 1, now: (c) => c.mastered, xp: 500, go: 'list' },
  },
};

/** 몬스터 이름: 지역 + 종류 */
export function monsterName(stage: number, r: Region) {
  const t = tierOf(stage).key;
  const kind = t === 'sprout' || t === 'bronze' ? '망각 슬라임' : t === 'silver' || t === 'gold' ? '망각 유령' : '망각 불꽃';
  return `${CHAPTERS[r.feature].place}의 ${kind}`;
}
