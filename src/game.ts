import type { Card, Stats } from './types';
import { MASTERED_STAGE } from './srs';

// ───────────────────────── 레벨 & 칭호 ─────────────────────────
// 필요 XP: Lv2=60, Lv3=180, Lv4=360 … (레벨이 오를수록 조금씩 더 필요)
export const xpForLevel = (lv: number) => 30 * (lv - 1) * lv;
export function levelOf(xp: number) {
  let lv = 1;
  while (xp >= xpForLevel(lv + 1)) lv++;
  return lv;
}

/** 말풍이 성장 단계: 레벨에 따라 모습과 칭호가 바뀐다 */
export const FORMS = [
  { lv: 1, title: '새싹 인턴', item: '새싹' },
  { lv: 3, title: '안전모 신입', item: '안전모' },
  { lv: 5, title: '도면 읽는 사원', item: '도면' },
  { lv: 8, title: '현장 소통 대리', item: '넥타이' },
  { lv: 12, title: '회의 리드 과장', item: '무전기' },
  { lv: 16, title: '클레임 협상 차장', item: '서류가방' },
  { lv: 20, title: '글로벌 PM', item: '황금 안전모' },
];
export const formIndex = (lv: number) => FORMS.reduce((i, f, k) => (lv >= f.lv ? k : i), 0);

// ───────────────────────── 캐릭터 그림 ─────────────────────────
/** 말풍선 모양 캐릭터 '말풍이'. mood: idle | happy | sad */
export function heroSVG(lv: number, mood: 'idle' | 'happy' | 'sad' = 'idle') {
  const f = formIndex(lv);
  const eyes =
    mood === 'happy'
      ? `<path d="M44 58 q6 -7 12 0 M66 58 q6 -7 12 0" stroke="var(--ink)" stroke-width="4.5" fill="none" stroke-linecap="round"/>`
      : mood === 'sad'
        ? `<path d="M44 56 l12 4 M78 56 l-12 4" stroke="var(--ink)" stroke-width="4.5" stroke-linecap="round"/><circle cx="50" cy="64" r="4" fill="var(--ink)"/><circle cx="72" cy="64" r="4" fill="var(--ink)"/>`
        : `<g class="eyes"><ellipse cx="50" cy="60" rx="5" ry="6.5" fill="var(--ink)"/><ellipse cx="72" cy="60" rx="5" ry="6.5" fill="var(--ink)"/><circle cx="52" cy="57.5" r="1.8" fill="#fff"/><circle cx="74" cy="57.5" r="1.8" fill="#fff"/></g>`;
  const mouth =
    mood === 'sad'
      ? `<path d="M54 78 q7 -6 14 0" stroke="var(--ink)" stroke-width="4" fill="none" stroke-linecap="round"/>`
      : `<path d="M53 73 q8 9 16 0" stroke="var(--ink)" stroke-width="4" fill="${mood === 'happy' ? 'var(--signal)' : 'none'}" stroke-linecap="round"/>`;
  const hat =
    f === 0
      ? `<path d="M61 26 v-10" stroke="#2fa35d" stroke-width="4" stroke-linecap="round"/><path d="M61 18 q-12 -10 -18 -2 q10 6 18 2z M61 16 q10 -12 18 -5 q-8 8 -18 5z" fill="#38c172"/>`
      : `<path d="M30 40 q31 -34 62 0 z" fill="${f >= 6 ? 'url(#gold)' : 'var(--safety)'}" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round"/>
         <rect x="24" y="37" width="74" height="9" rx="4.5" fill="${f >= 6 ? 'url(#gold)' : 'var(--safety)'}" stroke="var(--ink)" stroke-width="3.5"/>
         <path d="M61 14 v12" stroke="var(--ink)" stroke-width="3.5"/>${f >= 6 ? `<path d="M61 22 l3 6 6 1 -4.5 4 1 6 -5.5 -3 -5.5 3 1 -6 -4.5 -4 6 -1z" fill="#fff"/>` : ''}`;
  const tie = f >= 3 ? `<path d="M61 86 l-5 6 5 16 5 -16z" fill="var(--signal)" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>` : '';
  const prop =
    f === 2 || f === 3
      ? `<g transform="rotate(-18 102 86)"><rect x="92" y="70" width="14" height="36" rx="7" fill="#dbe8ff" stroke="var(--ink)" stroke-width="3.5"/><path d="M95 80 h8 M95 88 h8 M95 96 h8" stroke="#4a7bd1" stroke-width="2"/></g>`
      : f === 4
        ? `<g><rect x="94" y="72" width="16" height="28" rx="4" fill="#3b3f4a" stroke="var(--ink)" stroke-width="3.5"/><path d="M100 72 v-12" stroke="var(--ink)" stroke-width="3.5" stroke-linecap="round"/><rect x="98" y="78" width="8" height="6" rx="1" fill="#7cf0b2"/></g>`
        : f >= 5
          ? `<g><rect x="90" y="84" width="26" height="20" rx="4" fill="#8a5a3c" stroke="var(--ink)" stroke-width="3.5"/><path d="M98 84 v-5 h10 v5" stroke="var(--ink)" stroke-width="3.5" fill="none"/></g>`
          : '';
  const scale = 0.86 + Math.min(f, 6) * 0.025;
  return `<svg class="hero-svg mood-${mood}" viewBox="0 0 122 122" aria-hidden="true">
    <defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#ffbf1a"/><stop offset="1" stop-color="#e08a00"/></linearGradient></defs>
    <ellipse cx="61" cy="116" rx="30" ry="4.5" fill="var(--shadow-ink)"/>
    <g transform="translate(61 70) scale(${scale}) translate(-61 -70)">
      <path d="M22 70 q0 -36 39 -36 q39 0 39 36 q0 30 -30 32 l-10 13 -3 -13 q-35 -1 -35 -32z" fill="var(--hero)" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round"/>
      <ellipse cx="38" cy="72" rx="6" ry="4" fill="var(--blush)"/><ellipse cx="84" cy="72" rx="6" ry="4" fill="var(--blush)"/>
      ${eyes}${mouth}${tie}${hat}
    </g>${prop}
  </svg>`;
}

/** 망각 몬스터: 복습해야 할 표현 */
export function monsterSVG(state: 'idle' | 'hit' | 'laugh' = 'idle') {
  return `<svg class="mon-svg mon-${state}" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M18 88 V48 q0 -34 32 -34 q32 0 32 34 V88 l-8 -8 -8 8 -8 -8 -8 8 -8 -8 -8 8 -8 -8z" fill="var(--mon)" stroke="var(--ink)" stroke-width="3.5" stroke-linejoin="round"/>
    ${state === 'hit'
      ? `<path d="M34 40 l10 10 M44 40 l-10 10 M56 40 l10 10 M66 40 l-10 10" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>`
      : `<circle cx="39" cy="46" r="7" fill="#fff" stroke="var(--ink)" stroke-width="3"/><circle cx="61" cy="46" r="7" fill="#fff" stroke="var(--ink)" stroke-width="3"/><circle cx="41" cy="47" r="3" fill="var(--ink)"/><circle cx="63" cy="47" r="3" fill="var(--ink)"/>`}
    <path d="${state === 'laugh' ? 'M38 62 q12 14 24 0z' : 'M40 64 q10 -6 20 0'}" stroke="var(--ink)" stroke-width="3.5" fill="${state === 'laugh' ? 'var(--ink)' : 'none'}" stroke-linecap="round"/>
    <text x="50" y="30" text-anchor="middle" font-size="11" font-weight="900" fill="var(--ink)" opacity=".55">?</text>
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
  { id: 'fight', icon: '⚔️', label: '망각 몬스터 5마리 처치', goal: 5, xp: 30, value: (s: Stats) => s.day.correct },
  { id: 'make', icon: '✍️', label: '새 표현 1개 만들기', goal: 1, xp: 20, value: (s: Stats) => s.day.created },
  { id: 'listen', icon: '🎧', label: '20회 듣기 1번 완주', goal: 1, xp: 15, value: (s: Stats) => s.day.loops },
];

// ───────────────────────── 배지 ─────────────────────────
export const BADGES = [
  { id: 'first', icon: '🌱', name: '첫 마디', desc: '첫 표현 저장', test: (s: Stats, cs: Card[]) => cs.length >= 1 },
  { id: 'cards10', icon: '📒', name: '표현 수집가', desc: '표현 10개', test: (s: Stats, cs: Card[]) => cs.length >= 10 },
  { id: 'cards50', icon: '📚', name: '나만의 사전', desc: '표현 50개', test: (s: Stats, cs: Card[]) => cs.length >= 50 },
  { id: 'combo5', icon: '🔥', name: '불붙었다', desc: '5 콤보', test: (s: Stats) => s.bestCombo >= 5 },
  { id: 'combo10', icon: '☄️', name: '멈출 수 없어', desc: '10 콤보', test: (s: Stats) => s.bestCombo >= 10 },
  { id: 'streak3', icon: '📅', name: '작심삼일 돌파', desc: '3일 연속', test: (s: Stats) => s.streak >= 3 },
  { id: 'streak7', icon: '🗓️', name: '한 주 완주', desc: '7일 연속', test: (s: Stats) => s.streak >= 7 },
  { id: 'streak30', icon: '🏗️', name: '습관 준공', desc: '30일 연속', test: (s: Stats) => s.streak >= 30 },
  { id: 'perfect', icon: '🎯', name: '무결점', desc: '5문제 이상 전부 정답', test: (s: Stats) => s.totals.perfect >= 1 },
  { id: 'listen100', icon: '🎧', name: '귀가 트인다', desc: '누적 100회 듣기', test: (s: Stats) => s.totals.listens >= 100 },
  { id: 'master1', icon: '🏆', name: '첫 전설 카드', desc: '표현 1개 마스터', test: (s: Stats, cs: Card[]) => cs.some((c) => c.stage >= MASTERED_STAGE) },
  { id: 'lv8', icon: '👔', name: '대리 승진', desc: 'Lv.8 달성', test: (s: Stats) => levelOf(s.xp) >= 8 },
];

// ───────────────────────── 효과음 & 진동 ─────────────────────────
let ac: AudioContext | null = null;
export let soundOn = true;
export const setSound = (on: boolean) => (soundOn = on);

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'triangle', vol = 0.12) {
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + dur + 0.02);
}

export function sfx(kind: 'tap' | 'good' | 'bad' | 'levelup' | 'quest' | 'combo') {
  if (!soundOn) return;
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') ac.resume();
    if (kind === 'tap') tone(660, 0, 0.06, 'square', 0.04);
    if (kind === 'good') { tone(784, 0, 0.1); tone(1175, 0.08, 0.16); }
    if (kind === 'combo') { tone(880, 0, 0.08); tone(1175, 0.06, 0.08); tone(1568, 0.12, 0.18); }
    if (kind === 'bad') { tone(220, 0, 0.18, 'sawtooth', 0.06); tone(165, 0.12, 0.22, 'sawtooth', 0.06); }
    if (kind === 'quest') { [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.14)); }
    if (kind === 'levelup') { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.14)); }
  } catch { /* 소리 미지원 */ }
  const pattern = { tap: 8, good: 20, combo: [20, 40, 20], bad: [60, 40, 60], quest: [30, 30, 30], levelup: [40, 60, 40, 60, 120] }[kind];
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
