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

/** 강아지 성장 단계: 레벨에 따라 몸이 자라고 새 아이템이 생긴다 */
export const FORMS = [
  { lv: 1, title: '꼬물이 아기', item: '' },
  { lv: 3, title: '방울 강아지', item: '방울 목걸이' },
  { lv: 5, title: '산책왕', item: '반다나' },
  { lv: 8, title: '공놀이 달인', item: '테니스공' },
  { lv: 12, title: '똑똑한 멍멍이', item: '안경' },
  { lv: 16, title: '든든한 단짝', item: '망토' },
  { lv: 20, title: '전설의 명견', item: '왕관' },
];
export const formIndex = (lv: number) => FORMS.reduce((i, f, k) => (lv >= f.lv ? k : i), 0);

// ───────────────────────── 강아지 그림 ─────────────────────────
/** 앉아 있는 강아지. mood: idle(꼬리 흔들기) | happy | sad */
export function heroSVG(lv: number, mood: 'idle' | 'happy' | 'sad' = 'idle') {
  const f = formIndex(lv);
  const k = 'stroke="var(--ink)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"';
  const eyes =
    mood === 'happy'
      ? `<path d="M43 52 q5 -6 10 0 M69 52 q5 -6 10 0" ${k} fill="none"/>`
      : mood === 'sad'
        ? `<path d="M42 45 l9 3 M80 45 l-9 3" ${k}/><ellipse cx="48" cy="54" rx="4" ry="4.6" fill="var(--ink)"/><ellipse cx="74" cy="54" rx="4" ry="4.6" fill="var(--ink)"/>`
        : `<g class="eyes"><ellipse cx="48" cy="52" rx="4.6" ry="5.4" fill="var(--ink)"/><ellipse cx="74" cy="52" rx="4.6" ry="5.4" fill="var(--ink)"/><circle cx="49.6" cy="50" r="1.6" fill="#fff"/><circle cx="75.6" cy="50" r="1.6" fill="#fff"/></g>`;
  const mouth =
    mood === 'sad'
      ? `<path d="M61 66 v3 M54 73 q7 -5 14 0" ${k} fill="none"/>`
      : `<path d="M61 65 v4 M61 69 q-5 4 -9 0 M61 69 q5 4 9 0" ${k} fill="none"/>${mood === 'happy' ? `<path d="M57 71 q4 9 8 0z" fill="#ff7b8a" ${k}/>` : ''}`;
  const cape = f >= 5 ? `<path d="M38 78 q-12 30 -4 38 h54 q8 -8 -4 -38z" fill="var(--blue)" ${k}/>` : '';
  const neck =
    f >= 2
      ? `<path d="M44 79 h34 l-17 15z" fill="var(--signal)" ${k}/><circle cx="56" cy="83" r="1.6" fill="#fff"/><circle cx="66" cy="83" r="1.6" fill="#fff"/><circle cx="61" cy="88" r="1.6" fill="#fff"/>`
      : f >= 1
        ? `<path d="M43 79 q18 8 36 0" stroke="var(--red)" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="61" cy="86" r="4.5" fill="var(--safety)" ${k}/>`
        : '';
  const ball = f >= 3 ? `<g><circle cx="92" cy="108" r="8" fill="#d8f35a" ${k}/><path d="M85 104 q7 4 14 0 M85 112 q7 -4 14 0" stroke="#fff" stroke-width="2" fill="none"/></g>` : '';
  const glasses = f >= 4 ? `<g fill="none" ${k}><circle cx="48" cy="52" r="9"/><circle cx="74" cy="52" r="9"/><path d="M57 52 h8"/></g>` : '';
  const crown = f >= 6 ? `<path d="M46 31 l3 -14 8 9 4 -12 4 12 8 -9 3 14z" fill="url(#gold)" ${k}/>` : '';
  const scale = [0.72, 0.8, 0.86, 0.91, 0.95, 0.98, 1][f];
  return `<svg class="hero-svg mood-${mood}" viewBox="0 0 122 122" aria-hidden="true">
    <defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#ffbf1a"/><stop offset="1" stop-color="#e08a00"/></linearGradient></defs>
    <ellipse cx="61" cy="117" rx="34" ry="4.5" fill="var(--shadow-ink)"/>
    <g transform="translate(61 117) scale(${scale}) translate(-61 -117)">
      ${cape}
      <path class="tail" d="M84 100 q20 -4 18 -26" stroke="var(--ink)" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path class="tail" d="M84 100 q20 -4 18 -26" stroke="var(--fur)" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <ellipse cx="61" cy="96" rx="27" ry="21" fill="var(--fur)" ${k}/>
      <ellipse cx="61" cy="100" rx="14" ry="13" fill="var(--fur-2)"/>
      <ellipse cx="49" cy="113" rx="8" ry="5" fill="var(--fur-2)" ${k}/><ellipse cx="73" cy="113" rx="8" ry="5" fill="var(--fur-2)" ${k}/>
      ${neck}
      <ellipse cx="61" cy="54" rx="31" ry="27" fill="var(--fur)" ${k}/>
      <path d="M33 38 q-16 4 -13 30 q10 5 17 -9z" fill="var(--ear)" ${k}/>
      <path d="M89 38 q16 4 13 30 q-10 5 -17 -9z" fill="var(--ear)" ${k}/>
      <ellipse cx="61" cy="67" rx="14" ry="10" fill="var(--fur-2)"/>
      <ellipse cx="39" cy="64" rx="5.5" ry="3.5" fill="var(--blush)"/><ellipse cx="83" cy="64" rx="5.5" ry="3.5" fill="var(--blush)"/>
      ${eyes}${glasses}
      <ellipse cx="61" cy="62" rx="5.5" ry="4" fill="var(--ink)"/>
      ${mouth}${crown}
    </g>${ball}
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
  { id: 'fight', icon: '🎾', label: '공 5개 물어오기', goal: 5, xp: 30, value: (s: Stats) => s.day.correct },
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
  { id: 'streak30', icon: '🦮', name: '한 달 산책', desc: '30일 연속', test: (s: Stats) => s.streak >= 30 },
  { id: 'perfect', icon: '🎯', name: '무결점', desc: '5문제 이상 전부 정답', test: (s: Stats) => s.totals.perfect >= 1 },
  { id: 'listen100', icon: '🎧', name: '귀가 트인다', desc: '누적 100회 듣기', test: (s: Stats) => s.totals.listens >= 100 },
  { id: 'master1', icon: '🏆', name: '첫 전설 카드', desc: '표현 1개 마스터', test: (s: Stats, cs: Card[]) => cs.some((c) => c.stage >= MASTERED_STAGE) },
  { id: 'lv8', icon: '🐕', name: '다 컸네!', desc: 'Lv.8 달성', test: (s: Stats) => levelOf(s.xp) >= 8 },
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

export function sfx(kind: 'tap' | 'good' | 'bad' | 'levelup' | 'quest' | 'combo' | 'bark') {
  if (!soundOn) return;
  try {
    ac ??= new AudioContext();
    if (ac.state === 'suspended') ac.resume();
    if (kind === 'tap') tone(660, 0, 0.06, 'square', 0.04);
    if (kind === 'bark') { tone(520, 0, 0.07, 'square', 0.07); tone(380, 0.05, 0.09, 'square', 0.06); tone(560, 0.2, 0.07, 'square', 0.07); tone(400, 0.25, 0.09, 'square', 0.06); }
    if (kind === 'good') { tone(784, 0, 0.1); tone(1175, 0.08, 0.16); }
    if (kind === 'combo') { tone(880, 0, 0.08); tone(1175, 0.06, 0.08); tone(1568, 0.12, 0.18); }
    if (kind === 'bad') { tone(220, 0, 0.18, 'sawtooth', 0.06); tone(165, 0.12, 0.22, 'sawtooth', 0.06); }
    if (kind === 'quest') { [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.14)); }
    if (kind === 'levelup') { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.14)); }
  } catch { /* 소리 미지원 */ }
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
