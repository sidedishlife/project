// 휴대폰에서 고른 스티커 사진을 이 기기 안(IndexedDB)에만 저장. 인터넷에는 올라가지 않음
const DB = 'study-stickers';
const STORE = 'stickers';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAll(): Promise<Record<string, Blob>> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const out: Record<string, Blob> = {};
      const cur = db.transaction(STORE).objectStore(STORE).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        out[String(c.key)] = c.value as Blob;
        c.continue();
      };
      cur.onerror = () => resolve(out);
    });
  } catch {
    return {};
  }
}

export const saveOne = (name: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, name));
export const removeOne = (name: string) => tx('readwrite', (s) => s.delete(name));

/**
 * 흰 배경 스티커 사진에서 배경만 지움.
 * 가장자리부터 '거의 흰색'만 따라 채워 들어가면 스티커 둘레의 얇은 회색 칼선에서 멈춰서, 강아지 흰 털은 남는다.
 * 칼선의 작은 틈은 장벽을 두껍게 만들어 메운다. 이미 배경이 투명한 사진은 그대로 씀.
 */
export async function cutSticker(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const MAX = 720;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const WHITE = 244;
  const gap = Math.max(2, Math.round((15 * scale) / 2)); // 칼선을 두껍게 하는 반경

  // 1) 장벽: 흰색이 아니고 투명하지 않은 픽셀
  let barrier: Uint8Array = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    if (a < 128) continue;
    if (Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) < WHITE) barrier[i] = 1;
  }
  barrier = dilate(barrier, w, h, gap);

  // 2) 가장자리에서 채우기
  const bg = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  const push = (i: number) => { if (!bg[i] && !barrier[i]) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  // 3) 두껍게 만든 만큼 배경을 다시 넓혀 원래 칼선에 맞춤
  const bgWide = dilate(bg, w, h, Math.max(1, gap - 1));
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let i = 0; i < n; i++) {
    if (bgWide[i]) d[i * 4 + 3] = 0;
    else if (d[i * 4 + 3] > 20) {
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (maxX <= minX || maxY <= minY) throw new Error('스티커 모양을 찾지 못했어요. 흰 배경의 스티커 사진인지 확인해 주세요.');
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 저장하지 못했어요.'))), 'image/png'));
}

/** 정사각형 최대값 필터 (가로·세로 나눠서) */
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (src[y * w + x]) last = x; else if (x - last <= r) tmp[y * w + x] = 1;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) { last = x; tmp[y * w + x] = 1; } else if (last - x <= r) tmp[y * w + x] = 1; }
  }
  const out = new Uint8Array(src.length);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) last = y; else if (y - last <= r) out[y * w + x] = 1;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) { last = y; out[y * w + x] = 1; } else if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}
