import type { Card, Stats } from './types';
import { MASTERED_STAGE } from './srs';

/** 받침 있으면 a, 없으면 b (예: 콩이가 / 바둑이가 / 복실이가 / 몽실이가 → '가', 별 → '이') */
export function josa(word: string, a: string, b: string) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return b;
  return (c - 0xac00) % 28 ? a : b;
}

// ───────────────────────── 레벨 & 칭호 ─────────────────────────
// 필요 XP: Lv2=60, Lv3=180, Lv4=360 … (레벨이 오를수록 조금씩 더 필요)
export const xpForLevel = (lv: number) => 30 * (lv - 1) * lv;
export function levelOf(xp: number) {
  let lv = 1;
  while (xp >= xpForLevel(lv + 1)) lv++;
  return lv;
}

/** 말티즈 성장 단계: 레벨에 따라 몸이 자라고 새 아이템이 생긴다 */
export const FORMS = [
  { lv: 1, title: '꼬물이 아기 말티', item: '' },
  { lv: 3, title: '리본 말티', item: '핑크 리본' },
  { lv: 5, title: '산책 요정', item: '하트 목걸이' },
  { lv: 8, title: '공놀이 달인', item: '테니스공' },
  { lv: 12, title: '하트 멋쟁이', item: '하트 안경' },
  { lv: 16, title: '든든한 단짝', item: '꽃망토' },
  { lv: 20, title: '전설의 말티', item: '왕관' },
];
export const formIndex = (lv: number) => FORMS.reduce((i, f, k) => (lv >= f.lv ? k : i), 0);

/** 복슬복슬한 털: 타원 둘레를 따라 바깥으로 볼록한 물결 */
function fluff(cx: number, cy: number, rx: number, ry: number, n: number, amp: number, rot = 0) {
  const pt = (t: number, k: number) => {
    const x = Math.cos(t) * rx * k;
    const y = Math.sin(t) * ry * k;
    const c = Math.cos(rot), s = Math.sin(rot);
    return `${(cx + x * c - y * s).toFixed(1)} ${(cy + x * s + y * c).toFixed(1)}`;
  };
  let d = `M${pt(0, 1)}`;
  for (let i = 0; i < n; i++) {
    const t1 = ((i + 0.5) / n) * Math.PI * 2;
    const t2 = ((i + 1) / n) * Math.PI * 2;
    d += ` Q${pt(t1, 1 + amp)} ${pt(t2, 1)}`;
  }
  return d + 'Z';
}

const heart = (x: number, y: number, r: number) =>
  `M${x} ${y + r * 0.9} C${x - r * 1.6} ${y - r * 0.2} ${x - r * 0.9} ${y - r * 1.5} ${x} ${y - r * 0.5} C${x + r * 0.9} ${y - r * 1.5} ${x + r * 1.6} ${y - r * 0.2} ${x} ${y + r * 0.9}Z`;

const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z`;

// ───────────────────────── 말티즈 그림 ─────────────────────────
/** 앉아 있는 말티즈. mood: idle(꼬리 흔들기) | happy(혀 내밀고 반짝) | sad */
export function heroSVG(lv: number, mood: 'idle' | 'happy' | 'sad' = 'idle') {
  const f = formIndex(lv);
  const k = 'stroke="var(--ink)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"';
  const eye = (x: number) =>
    mood === 'sad'
      ? `<ellipse cx="${x}" cy="66" rx="6.2" ry="5.6" fill="var(--ink)"/><path d="M${x - 7} 62 h14" stroke="var(--fur)" stroke-width="4.5"/><circle cx="${x + 2}" cy="66.5" r="1.6" fill="#fff"/>`
      : `<ellipse cx="${x}" cy="64" rx="7" ry="7.4" fill="var(--ink)"/><circle cx="${x + 2.4}" cy="61.2" r="2.4" fill="#fff"/><circle cx="${x - 2.4}" cy="67" r="1.1" fill="#fff"/>`;
  const brows = mood === 'sad' ? `<path d="M50 55 l8 3 M90 55 l-8 3" ${k}/>` : '';
  const mouth =
    mood === 'happy'
      ? `<path d="M62 80 q8 9 16 0 z" fill="#5a2a35" ${k}/><path d="M65 83 q5 9 10 0 q-5 -3 -10 0z" fill="var(--tongue)"/>`
      : mood === 'sad'
        ? `<path d="M64 85 q6 -4 12 0" ${k} fill="none"/>`
        : `<path d="M70 79 v2.5 M70 81.5 q-4 3.5 -7.5 0 M70 81.5 q4 3.5 7.5 0" ${k} fill="none"/>`;
  const cape = f >= 5 ? `<path d="${fluff(70, 112, 36, 18, 14, 0.12)}" fill="var(--cape)" ${k}/>${[52, 66, 82, 94].map((x, i) => `<circle cx="${x}" cy="${118 + (i % 2) * 6}" r="3" fill="#fff" opacity=".8"/>`).join('')}` : '';
  const necklace = f >= 2 ? `<path d="M56 95 q14 7 28 0" stroke="var(--pink-d)" stroke-width="2.4" fill="none"/><path d="${heart(70, 100, 5)}" fill="var(--pink)" ${k}/>` : '';
  const ball = f >= 3 ? `<g><circle cx="116" cy="124" r="9" fill="#d8f35a" ${k}/><path d="M108 120 q8 5 16 0 M108 128 q8 -5 16 0" stroke="#fff" stroke-width="2" fill="none"/></g>` : '';
  const glasses = f >= 4 ? `<g><path d="${heart(56, 65, 9)}" fill="var(--pink)" fill-opacity=".35" ${k}/><path d="${heart(84, 65, 9)}" fill="var(--pink)" fill-opacity=".35" ${k}/><path d="M64 63 q6 -3 12 0" ${k} fill="none"/></g>` : '';
  const bow =
    f >= 1
      ? `<g class="bow"><path d="M70 30 C58 28 44 20 44 8 C54 6 66 16 70 30Z" fill="url(#stripe)" ${k}/><path d="M70 30 C80 18 92 2 106 4 C106 18 88 28 70 30Z" fill="url(#stripe)" ${k}/><circle cx="70" cy="30" r="5.5" fill="var(--pink)" ${k}/><path d="M63 36 q7 4 14 0" stroke="var(--pink-d)" stroke-width="4" stroke-linecap="round"/></g>`
      : `<path d="M66 36 q4 -6 8 0" stroke="var(--pink-d)" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
  const earTies = f >= 2 ? `<rect x="34" y="56" width="8" height="5" rx="2.5" fill="var(--pink)" ${k} stroke-width="1.6"/><rect x="98" y="56" width="8" height="5" rx="2.5" fill="var(--pink)" ${k} stroke-width="1.6"/>` : '';
  const crown = f >= 6 ? `<path d="M56 24 l2 -12 7 7 5 -11 5 11 7 -7 2 12z" fill="url(#gold)" ${k}/>` : '';
  const sparkles = mood === 'happy' ? `<g class="sparkles"><path d="${sparkle(18, 30, 8)}" fill="var(--sparkle)" ${k} stroke-width="2"/><path d="${sparkle(30, 16, 5)}" fill="var(--sparkle)" ${k} stroke-width="2"/><path d="${sparkle(122, 40, 6)}" fill="var(--sparkle)" ${k} stroke-width="2"/></g>` : '';
  const scale = [0.74, 0.8, 0.86, 0.9, 0.94, 0.97, 1][f];
  return `<svg class="hero-svg mood-${mood}" viewBox="0 0 140 140" aria-hidden="true">
    <defs>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#ffbf1a"/><stop offset="1" stop-color="#e08a00"/></linearGradient>
      <pattern id="stripe" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="5" height="5" fill="var(--pink)"/><rect width="2" height="5" fill="#fff" opacity=".75"/></pattern>
    </defs>
    <ellipse cx="70" cy="134" rx="38" ry="4.5" fill="var(--shadow-ink)"/>
    <g transform="translate(70 134) scale(${scale}) translate(-70 -134)">
      ${cape}
      <path class="tail" d="${fluff(104, 104, 13, 9, 9, 0.22, -0.9)}" fill="var(--fur)" ${k}/>
      <path d="${fluff(70, 110, 30, 21, 14, 0.1)}" fill="var(--fur)" ${k}/>
      <path d="${fluff(58, 128, 9, 6, 7, 0.14)}" fill="var(--fur)" ${k}/><path d="${fluff(82, 128, 9, 6, 7, 0.14)}" fill="var(--fur)" ${k}/>
      ${necklace}
      <path d="${fluff(70, 62, 35, 31, 18, 0.08)}" fill="var(--fur)" ${k}/>
      <path d="${fluff(70, 40, 12, 9, 9, 0.18)}" fill="var(--fur)" ${k}/>
      <path class="ear" d="${fluff(38, 80, 13, 26, 11, 0.16, 0.12)}" fill="var(--fur)" ${k}/>
      <path class="ear" d="${fluff(102, 80, 13, 26, 11, 0.16, -0.12)}" fill="var(--fur)" ${k}/>
      ${earTies}
      <ellipse cx="70" cy="77" rx="13" ry="9" fill="var(--fur-2)"/>
      <ellipse cx="47" cy="76" rx="5" ry="3.2" fill="var(--blush)"/><ellipse cx="93" cy="76" rx="5" ry="3.2" fill="var(--blush)"/>
      <g class="eyes">${eye(56)}${eye(84)}</g>${brows}${glasses}
      <ellipse cx="70" cy="74" rx="6" ry="4.6" fill="var(--ink)"/><ellipse cx="68" cy="72.6" rx="2" ry="1.2" fill="#fff" opacity=".7"/>
      ${mouth}${bow}${crown}
    </g>${ball}${sparkles}
  </svg>`;
}

/** 물어올 공: 복습할 표현 하나 */
export function ballSVG() {
  return `<svg class="ball-svg" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="30" fill="#d8f35a" stroke="var(--ink)" stroke-width="3.5"/>
    <path d="M24 36 q26 16 52 0 M24 64 q26 -16 52 0" stroke="#fff" stroke-width="4" fill="none"/>
    <text x="50" y="58" text-anchor="middle" font-size="22" font-weight="900" fill="var(--ink)" opacity=".55">?</text>
  </svg>`;
}

// ───────────────────────── 표현 카드 등급 ─────────────────────────
export function rarity(c: Card) {
  if (c.stage >= MASTERED_STAGE) return { key: 'legend', label: '전설' };
  if (c.stage >= 5) return { key: 'epic', label: '영웅' };
  if (c.stage >= 3) return { key: 'rare', label: '희귀' };
  if (c.stage >= 1) return { key: 'uncommon', label: '고급' };
  return { key: 'common', label: '일반' };
}

// ───────────────────────── 일일 퀘스트 ─────────────────────────
export const QUESTS = [
  { id: 'fight', icon: 'ball', label: '공 5개 물어오기', goal: 5, xp: 30, value: (s: Stats) => s.day.correct },
  { id: 'make', icon: 'pen', label: '새 표현 1개 만들기', goal: 1, xp: 20, value: (s: Stats) => s.day.created },
  { id: 'listen', icon: 'headphones', label: '20회 듣기 1번 완주', goal: 1, xp: 15, value: (s: Stats) => s.day.loops },
];

// ───────────────────────── 배지 ─────────────────────────
export const BADGES = [
  { id: 'first', icon: 'sparkle', name: '첫 마디', desc: '첫 표현 저장', test: (s: Stats, cs: Card[]) => cs.length >= 1 },
  { id: 'cards10', icon: 'card', name: '표현 수집가', desc: '표현 10개', test: (s: Stats, cs: Card[]) => cs.length >= 10 },
  { id: 'cards50', icon: 'book', name: '나만의 사전', desc: '표현 50개', test: (s: Stats, cs: Card[]) => cs.length >= 50 },
  { id: 'combo5', icon: 'flame', name: '불붙었다', desc: '5 콤보', test: (s: Stats) => s.bestCombo >= 5 },
  { id: 'combo10', icon: 'flame', name: '멈출 수 없어', desc: '10 콤보', test: (s: Stats) => s.bestCombo >= 10 },
  { id: 'streak3', icon: 'calendar', name: '작심삼일 돌파', desc: '3일 연속', test: (s: Stats) => s.streak >= 3 },
  { id: 'streak7', icon: 'calendar', name: '한 주 완주', desc: '7일 연속', test: (s: Stats) => s.streak >= 7 },
  { id: 'streak30', icon: 'calendar', name: '한 달 산책', desc: '30일 연속', test: (s: Stats) => s.streak >= 30 },
  { id: 'perfect', icon: 'target', name: '무결점', desc: '5문제 이상 전부 정답', test: (s: Stats) => s.totals.perfect >= 1 },
  { id: 'listen100', icon: 'headphones', name: '귀가 트인다', desc: '누적 100회 듣기', test: (s: Stats) => s.totals.listens >= 100 },
  { id: 'master1', icon: 'crown', name: '첫 전설 카드', desc: '표현 1개 마스터', test: (s: Stats, cs: Card[]) => cs.some((c) => c.stage >= MASTERED_STAGE) },
  { id: 'lv8', icon: 'paw', name: '다 컸네!', desc: 'Lv.8 달성', test: (s: Stats) => levelOf(s.xp) >= 8 },
];

// ───────────────────────── 진동 ─────────────────────────
// 효과음은 쓰지 않음(사용자 요청). 안드로이드에서만 짧은 진동으로 손맛을 줌
export let soundOn = true; // 설정의 '진동' 켜기/끄기
export const setSound = (on: boolean) => (soundOn = on);

export function sfx(kind: 'tap' | 'good' | 'bad' | 'levelup' | 'quest' | 'combo' | 'bark') {
  if (!soundOn) return;
  const pattern = { bark: [15, 60, 15], tap: 8, good: 20, combo: [20, 40, 20], bad: [60, 40, 60], quest: [30, 30, 30], levelup: [40, 60, 40, 60, 120] }[kind];
  try { navigator.vibrate?.(pattern as number | number[]); } catch { /* 진동 미지원 */ }
}

// ───────────────────────── 꽃가루 ─────────────────────────
export function confetti(ms = 1800) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d')!;
  const W = (cv.width = innerWidth * devicePixelRatio);
  const H = (cv.height = innerHeight * devicePixelRatio);
  const colors = ['#ffc21a', '#ff6a2b', '#2fd08a', '#4a8cff', '#ff5fa2', '#ffffff'];
  const ps = Array.from({ length: 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.45,
    vx: (Math.random() - 0.5) * 22 * devicePixelRatio, vy: (-Math.random() * 22 - 8) * devicePixelRatio,
    r: (4 + Math.random() * 6) * devicePixelRatio, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6,
  }));
  const t0 = performance.now();
  (function frame(t: number) {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.9 * devicePixelRatio; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += 0.2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (t - t0 < ms) requestAnimationFrame(frame);
    else cv.remove();
  })(t0);
}

/** 화면 중앙에 떠오르는 +XP 숫자 */
export function floatXp(text: string, anchor?: Element | null) {
  const el = document.createElement('div');
  el.className = 'float-xp';
  el.textContent = text;
  const r = anchor?.getBoundingClientRect();
  el.style.left = `${r ? r.left + r.width / 2 : innerWidth / 2}px`;
  el.style.top = `${r ? r.top : innerHeight / 2}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}
