import { heroSVG } from './game';

// 말티즈 사진 스티커. 원본은 stickers-src/, 변환은 scripts/make-stickers.py
// 파일이 없으면(예: 저장소에 사진을 올리지 않은 경우) 그림 캐릭터로 대신 보여줌
import { bundled } from './sticker-assets';
import { loadAll, saveOne, removeOne, cutSticker } from './sticker-store';

// 휴대폰에 저장한 스티커 (이름 → 화면용 주소)
const local: Record<string, string> = {};
const url = (name: string) => bundled[`./stickers/${name}.webp`] ?? local[name];
/** 앱에 사진이 들어 있으면(claude.ai용) 휴대폰에서 넣는 기능은 필요 없음 */
export const stickersBundled = () => Object.keys(bundled).length > 0;
export const localSticker = (name: string) => local[name];

export async function loadLocalStickers() {
  if (stickersBundled()) return;
  const all = await loadAll();
  for (const [k, blob] of Object.entries(all)) {
    if (local[k]) URL.revokeObjectURL(local[k]);
    local[k] = URL.createObjectURL(blob);
  }
}
export async function setLocalSticker(name: string, file: Blob) {
  const cut = await cutSticker(file);
  await saveOne(name, cut);
  if (local[name]) URL.revokeObjectURL(local[name]);
  local[name] = URL.createObjectURL(cut);
}
export async function clearLocalSticker(name: string) {
  await removeOne(name);
  if (local[name]) URL.revokeObjectURL(local[name]);
  delete local[name];
}

export type StickerName = 'wink' | 'excited' | 'what' | 'yawn' | 'happy' | 'love' | 'surprised' | 'cool' | 'angry';

/** 스티커 목록: 앞의 4장은 처음부터, 나머지는 레벨이 오르면 열림 */
export const STICKERS: { name: StickerName; label: string; lv: number; when: string }[] = [
  { name: 'wink', label: '윙크!', lv: 1, when: '홈에서 인사할 때' },
  { name: 'excited', label: '신나!', lv: 1, when: '놀 공이 있을 때' },
  { name: 'what', label: '뭐야?', lv: 1, when: '헷갈렸을 때' },
  { name: 'yawn', label: '하품~', lv: 1, when: '낮잠 잘 때' },
  { name: 'happy', label: '행복해!', lv: 3, when: '공을 물어왔을 때' },
  { name: 'love', label: '사랑해', lv: 5, when: '쓰다듬어 줄 때' },
  { name: 'surprised', label: '깜짝이야!', lv: 8, when: '새 카드를 얻었을 때' },
  { name: 'cool', label: '멋져?', lv: 12, when: '레벨이 올랐을 때' },
  { name: 'angry', label: '화났어!', lv: 16, when: '공을 놓쳤을 때' },
];
/** Lv.20 보상: 모든 스티커에 황금 테두리 */
export const GOLD_LEVEL = 20;

// 잠긴 스티커 대신 쓸 기본 스티커
const FALLBACK: Record<StickerName, StickerName> = {
  wink: 'wink', excited: 'excited', what: 'what', yawn: 'yawn',
  happy: 'excited', love: 'excited', surprised: 'excited', cool: 'excited', angry: 'what',
};

export const unlocked = (name: StickerName, lv: number) => lv >= (STICKERS.find((s) => s.name === name)?.lv ?? 1);
/** 이번 레벨에 새로 열린 스티커 */
export const newlyUnlocked = (from: number, to: number) => STICKERS.filter((s) => s.lv > from && s.lv <= to);

const MOOD: Record<StickerName, 'idle' | 'happy' | 'sad'> = {
  wink: 'idle', excited: 'happy', what: 'sad', yawn: 'idle', happy: 'happy', love: 'happy', surprised: 'happy', cool: 'happy', angry: 'sad',
};

/** 레벨에 맞는 스티커 이미지. 잠겼으면 기본 스티커로 */
export function sticker(name: StickerName, lv: number, cls = '') {
  const use = unlocked(name, lv) ? name : FALLBACK[name];
  const src = url(use);
  const gold = lv >= GOLD_LEVEL ? ' gold' : '';
  if (!src) return `<span class="sticker-fallback ${cls}">${heroSVG(lv, MOOD[use])}</span>`;
  const label = STICKERS.find((s) => s.name === use)!.label;
  return `<img class="sticker${gold} ${cls}" src="${src}" alt="${label}" draggable="false">`;
}

/** 도감용: 잠김 여부와 상관없이 그 스티커 자체 */
export function stickerRaw(name: StickerName, cls = '') {
  const src = url(name);
  const label = STICKERS.find((s) => s.name === name)!.label;
  return src ? `<img class="sticker ${cls}" src="${src}" alt="${label}" draggable="false">` : `<span class="sticker-fallback ${cls}">${label}</span>`;
}
