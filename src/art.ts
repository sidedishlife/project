// 게임 그림 (Gemini 이미지 모델로 생성 → 배경 제거 → public/art/*.webp)
import type { Region } from './game';
import { tierOf } from './game';

export type Face = 'happy' | 'wow' | 'sad';
const A = (f: string) => `./art/${f}.webp`;

/** 서 있는 주인공 (전신) */
export const heroImg = (cls = '') => `<img class="hero-img ${cls}" src="${A('hero')}" alt="주인공" draggable="false">`;
/** 주문을 외치는 주인공 (전투) */
export const castImg = (cls = '') => `<img class="hero-img ${cls}" src="${A('hero-cast')}" alt="주문을 외치는 주인공" draggable="false">`;
/** 대화창 초상화 (상반신, 표정) */
export const faceImg = (f: Face, cls = '') => `<img class="face-img ${cls}" src="${A(`face-${f}`)}" alt="" draggable="false">`;
export const faceUrl = (f: Face) => A(`face-${f}`);

/** 카드의 기억 단계가 높을수록 강한 몬스터 */
export function monsterImg(stage: number, hit = false) {
  const t = tierOf(stage).key;
  const kind = t === 'sprout' || t === 'bronze' ? 'slime' : t === 'silver' || t === 'gold' ? 'ghost' : 'fire';
  return `<img class="mon-img ${hit ? 'hit' : ''}" src="${A(`mon-${kind}`)}" alt="몬스터" draggable="false">`;
}

/** 지역 배경 */
export const sceneBg = (r: Region) => `<div class="scene" style="background-image:url(${A(`bg-${r.feature}`)})"></div>`;

/** 처음 열 때 그림을 미리 받아 둠 (화면 전환 때 깜빡임 방지) */
export function preloadArt() {
  for (const f of ['npc-teacher', 'hero', 'hero-cast', 'face-happy', 'face-wow', 'face-sad', 'mon-slime', 'mon-ghost', 'mon-fire', 'bg-village']) {
    const i = new Image(); i.src = A(f);
  }
}

export const npcImg = (img: string, cls = '') => `<img class="face-img ${cls}" src="${A(img)}" alt="" draggable="false">`;
