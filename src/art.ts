// 코드로 그린 2D 그림: 주인공(견습 마법사 소녀), 몬스터, 지역 배경. 외부 그림 파일 없음
import type { Region } from './game';

export type Face = 'normal' | 'happy' | 'wow' | 'sad';

/** 레벨 구간마다 망토 색이 바뀜 */
const CAPES = ['#5b7bd5', '#3f9e6e', '#2f86c2', '#7b5bd5', '#d5763b'];

let uid = 0;
/** 주인공. size: 화면에 그릴 높이(px) */
export function heroine(face: Face = 'normal', regionIndex = 0, size = 150) {
  const id = `h${uid++}`;
  const cape = CAPES[Math.min(regionIndex, CAPES.length - 1)];
  const eyes = {
    normal: `<ellipse cx="49" cy="66" rx="4.2" ry="6" fill="#2b2140"/><ellipse cx="71" cy="66" rx="4.2" ry="6" fill="#2b2140"/>
      <circle cx="50.5" cy="63.5" r="1.8" fill="#fff"/><circle cx="72.5" cy="63.5" r="1.8" fill="#fff"/>`,
    happy: `<path d="M44 67 q5 -6 10 0" stroke="#2b2140" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M66 67 q5 -6 10 0" stroke="#2b2140" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    wow: `<circle cx="49" cy="66" r="5" fill="#2b2140"/><circle cx="71" cy="66" r="5" fill="#2b2140"/>
      <circle cx="50.5" cy="64" r="1.8" fill="#fff"/><circle cx="72.5" cy="64" r="1.8" fill="#fff"/>`,
    sad: `<ellipse cx="49" cy="67" rx="4" ry="5" fill="#2b2140"/><ellipse cx="71" cy="67" rx="4" ry="5" fill="#2b2140"/>
      <path d="M43 61 l9 -3 M77 61 l-9 -3" stroke="#2b2140" stroke-width="2" stroke-linecap="round"/>`,
  }[face];
  const mouth = {
    normal: `<path d="M56 78 q4 3 8 0" stroke="#a5485a" stroke-width="2" fill="none" stroke-linecap="round"/>`,
    happy: `<path d="M54 76 q6 8 12 0 z" fill="#c4505f"/>`,
    wow: `<ellipse cx="60" cy="79" rx="3.2" ry="4" fill="#c4505f"/>`,
    sad: `<path d="M55 80 q5 -4 10 0" stroke="#a5485a" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  }[face];
  return `<svg class="heroine" viewBox="0 0 120 160" width="${size * 0.75}" height="${size}" aria-label="주인공">
  <defs>
    <linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cape}"/><stop offset="1" stop-color="#2a2f55"/></linearGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f6b"/><stop offset="1" stop-color="#23264a"/></linearGradient>
  </defs>
  <ellipse cx="60" cy="152" rx="30" ry="6" fill="#000" opacity=".18"/>
  <!-- 뒷머리 (긴 머리) -->
  <path d="M30 62 q-6 40 6 62 q10 6 18 -4 L54 78 Z M90 62 q6 40 -6 62 q-10 6 -18 -4 L66 78 Z" fill="url(#${id}h)"/>
  <!-- 망토와 옷 -->
  <path d="M36 98 L28 140 q32 10 64 0 L84 98 q-24 -10 -48 0 Z" fill="url(#${id}c)"/>
  <path d="M46 98 L42 138 q18 5 36 0 L74 98 Z" fill="#fff6e0"/>
  <path d="M52 100 h16 l-2 6 h-12 z" fill="#e7b84a"/>
  <!-- 다리 -->
  <rect x="49" y="136" width="8" height="12" rx="3" fill="#6b4a3a"/><rect x="63" y="136" width="8" height="12" rx="3" fill="#6b4a3a"/>
  <!-- 주문서(책) -->
  <g transform="rotate(-8 82 118)"><rect x="70" y="108" width="24" height="18" rx="2" fill="#a8322f"/><rect x="72" y="110" width="20" height="14" rx="1" fill="#f6e7c1"/><path d="M82 110 v14" stroke="#a8322f" stroke-width="1.5"/><text x="82" y="121" font-size="7" text-anchor="middle" fill="#7a4b18" font-weight="700">ABC</text></g>
  <circle cx="72" cy="118" r="5" fill="#ffe0c8"/><circle cx="44" cy="114" r="5" fill="#ffe0c8"/>
  <!-- 머리 -->
  <circle cx="60" cy="66" r="29" fill="#ffe2cc"/>
  <ellipse cx="42" cy="75" rx="5" ry="3" fill="#ff9fae" opacity=".55"/><ellipse cx="78" cy="75" rx="5" ry="3" fill="#ff9fae" opacity=".55"/>
  ${eyes}${mouth}
  <!-- 앞머리 -->
  <path d="M31 62 q2 -24 29 -26 q27 2 29 26 q-8 -10 -16 -12 q-2 7 -8 9 q0 -7 -5 -10 q-6 9 -15 10 q2 -5 1 -9 q-9 4 -15 12 Z" fill="url(#${id}h)"/>
  <path d="M86 70 q8 16 2 34" stroke="#2c3160" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="87" cy="104" r="4" fill="#e7b84a"/>
  <!-- 마법사 모자 -->
  <path d="M26 46 q34 -12 68 0 q-6 6 -34 6 q-28 0 -34 -6 Z" fill="#2a2f55"/>
  <path d="M36 44 Q52 -2 84 8 Q70 14 80 42 Z" fill="${cape}"/>
  <path d="M38 40 q22 -6 42 0 l-1 5 q-20 -5 -40 0 z" fill="#e7b84a"/>
  <path d="M60 22 l2.2 4.6 5 .7 -3.6 3.5 .9 5 -4.5 -2.4 -4.5 2.4 .9 -5 -3.6 -3.5 5 -.7 z" fill="#ffe27a"/>
</svg>`;
}

/** 복습 몬스터: 카드마다 색이 조금씩 다른 슬라임 */
export function monster(seed: string, hit = false, size = 120) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const body = `hsl(${hue} 70% 62%)`, dark = `hsl(${hue} 55% 42%)`;
  return `<svg class="monster ${hit ? 'hit' : ''}" viewBox="0 0 120 110" width="${size}" height="${size * 0.92}" aria-label="몬스터">
  <ellipse cx="60" cy="102" rx="40" ry="6" fill="#000" opacity=".2"/>
  <path d="M14 96 Q8 40 60 22 Q112 40 106 96 Q84 104 60 100 Q36 104 14 96 Z" fill="${body}" stroke="${dark}" stroke-width="3"/>
  <path d="M60 22 q-4 -12 6 -16 q-2 8 4 12" fill="${body}" stroke="${dark}" stroke-width="3"/>
  <ellipse cx="40" cy="48" rx="10" ry="6" fill="#fff" opacity=".45"/>
  ${hit
    ? `<path d="M38 60 l10 8 M48 60 l-10 8 M72 60 l10 8 M82 60 l-10 8" stroke="#2b2140" stroke-width="3" stroke-linecap="round"/>`
    : `<ellipse cx="44" cy="64" rx="7" ry="9" fill="#fff"/><ellipse cx="76" cy="64" rx="7" ry="9" fill="#fff"/>
       <circle cx="45" cy="66" r="4" fill="#2b2140"/><circle cx="77" cy="66" r="4" fill="#2b2140"/>`}
  <path d="M50 82 q10 ${hit ? -6 : 6} 20 0" stroke="#2b2140" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;
}

/** 지역 배경 (하늘·언덕·지역 특징) */
export function scene(r: Region) {
  const feat = {
    village: `<g fill="#c97b4a" stroke="#6b3f22" stroke-width="2"><rect x="40" y="96" width="44" height="34"/><rect x="250" y="102" width="40" height="28"/></g>
      <g fill="#d9534f" stroke="#6b3f22" stroke-width="2"><path d="M34 98 L62 74 L90 98 Z"/><path d="M244 104 L270 82 L296 104 Z"/></g>
      <g fill="#ffe9a8"><rect x="54" y="106" width="10" height="10"/><rect x="262" y="110" width="9" height="9"/></g>`,
    forest: Array.from({ length: 7 }, (_, i) => `<g transform="translate(${20 + i * 48} ${84 + (i % 2) * 10})"><rect x="9" y="30" width="6" height="18" fill="#6b4a2e"/><path d="M12 -4 L32 34 L-8 34 Z" fill="#2f7a3f"/><path d="M12 8 L28 38 L-4 38 Z" fill="#3c9150"/></g>`).join(''),
    harbor: `<rect x="0" y="108" width="360" height="30" fill="#4aa3df"/><path d="M0 112 q20 -4 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#bfe6ff" stroke-width="2" fill="none"/>
      <g transform="translate(220 70)"><path d="M0 40 h60 l-8 12 h-44 z" fill="#8a5a33"/><path d="M30 0 v40" stroke="#5a3a20" stroke-width="3"/><path d="M32 4 q20 14 0 32 z" fill="#fff8e7"/></g>`,
    castle: `<g fill="#cfd3e8" stroke="#6f7aa0" stroke-width="2"><rect x="130" y="66" width="100" height="64"/><rect x="118" y="50" width="26" height="80"/><rect x="216" y="50" width="26" height="80"/></g>
      <g fill="#7b5bd5"><path d="M114 52 L131 26 L148 52 Z"/><path d="M212 52 L229 26 L246 52 Z"/></g><path d="M168 130 v-26 q12 -12 24 0 v26 z" fill="#4b4f75"/>`,
    kingdom: `<g fill="#f2d39a" stroke="#a8773a" stroke-width="2"><rect x="100" y="56" width="160" height="74"/><rect x="90" y="40" width="30" height="90"/><rect x="240" y="40" width="30" height="90"/><rect x="160" y="30" width="40" height="40"/></g>
      <g fill="#d5763b"><path d="M86 42 L105 14 L124 42 Z"/><path d="M236 42 L255 14 L274 42 Z"/><path d="M156 32 L180 4 L204 32 Z"/></g><path d="M180 4 v-12 l14 5 -14 5" fill="#e74c3c"/>`,
  }[r.feature];
  return `<svg class="scene" viewBox="0 0 360 160" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="sky-${r.feature}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${r.sky[0]}"/><stop offset="1" stop-color="${r.sky[1]}"/></linearGradient>
  <linearGradient id="gr-${r.feature}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${r.ground[0]}"/><stop offset="1" stop-color="${r.ground[1]}"/></linearGradient></defs>
  <rect width="360" height="160" fill="url(#sky-${r.feature})"/>
  <circle cx="310" cy="32" r="16" fill="#fff6c9" opacity=".9"/>
  <g fill="#fff" opacity=".85"><ellipse cx="70" cy="34" rx="26" ry="9"/><ellipse cx="88" cy="28" rx="16" ry="9"/><ellipse cx="210" cy="22" rx="22" ry="7"/></g>
  <path d="M0 112 q90 -30 180 -6 t180 -10 V160 H0 Z" fill="${r.ground[1]}" opacity=".6"/>
  ${feat}
  <path d="M0 128 q90 -14 180 -2 t180 -6 V160 H0 Z" fill="url(#gr-${r.feature})"/>
</svg>`;
}
