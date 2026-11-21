// Gemini가 만든 진짜 음성 파일로 영어를 읽어 줌.
// 아이폰의 '음성 읽기' 기능은 무음 모드 등에서 소리가 안 나는 경우가 많지만,
// 일반 오디오 재생(동영상 소리와 같은 방식)은 무음 모드에서도 소리가 난다.
// 문장마다 한 번만 만들어 이 휴대폰(IndexedDB)에 저장하고, 반복 재생은 저장된 파일로 함.

const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts'];
const VOICE = 'Kore';
const URL_FOR = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

let key = '';
export const setGeminiKey = (k: string) => { key = k; };
export const geminiVoiceReady = () => !!key;

// ── 저장소
const DB = 'study-audio';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('audio');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function getCached(id: string): Promise<Blob | undefined> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const r = d.transaction('audio').objectStore('audio').get(id);
      r.onsuccess = () => resolve(r.result as Blob | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}
async function putCached(id: string, blob: Blob) {
  try {
    const d = await db();
    await new Promise((resolve) => {
      const r = d.transaction('audio', 'readwrite').objectStore('audio').put(blob, id);
      r.onsuccess = r.onerror = () => resolve(null);
    });
  } catch { /* 저장 실패해도 재생은 함 */ }
}

// ── 원본 음성(PCM 16비트, 24kHz, 1채널) → WAV 파일
function pcmToWav(b64: string, rate = 24000): Blob {
  const bin = atob(b64);
  const n = bin.length;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, n, true);
  const out = new Uint8Array(buf, 44);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'audio/wav' });
}

export class TTSError extends Error { constructor(msg: string, public quota = false) { super(msg); } }

let workingModel = '';
const inflight = new Map<string, Promise<Blob>>();

/** 문장의 음성 파일 (저장돼 있으면 그대로, 없으면 Gemini로 만들어 저장) */
export function getVoice(text: string): Promise<Blob> {
  const id = `${VOICE}|${text.trim()}`;
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    const hit = await getCached(id);
    if (hit) return hit;
    if (!key) throw new TTSError('Gemini 키가 없어요');
    const models = workingModel ? [workingModel, ...TTS_MODELS.filter((m) => m !== workingModel)] : TTS_MODELS;
    let quota = false, last = '';
    for (const m of models) {
      let res: Response;
      try {
        res = await fetch(URL_FOR(m), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Say clearly and naturally in American English: ${text}` }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
          }),
        });
      } catch { throw new TTSError('인터넷 연결을 확인해 주세요'); }
      const body: any = await res.json().catch(() => ({}));
      if (res.status === 429) { quota = true; last = '무료 한도'; continue; }
      if (!res.ok) { last = `${res.status} ${body?.error?.message ?? ''}`.trim(); continue; }
      const part = body?.candidates?.[0]?.content?.parts?.find((x: any) => x.inlineData?.data);
      if (!part) { last = '음성이 비어 있음'; continue; }
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1]) || 24000;
      const blob = pcmToWav(part.inlineData.data, rate);
      workingModel = m;
      await putCached(id, blob);
      return blob;
    }
    throw new TTSError(quota ? 'Gemini 음성 무료 한도를 다 썼어요' : `Gemini 음성을 만들지 못했어요 (${last})`, quota);
  })();
  inflight.set(id, p);
  p.finally(() => inflight.delete(id)).catch(() => {}); // 실패는 부르는 쪽에서 처리
  return p;
}

/** 미리 만들어 두기 (실패해도 조용히) */
export function prefetchVoice(text: string) {
  if (key && text.trim().split(/\s+/).length >= 2) getVoice(text).catch(() => {});
}

// ── 재생기: 하나의 오디오 요소를 계속 씀. 첫 터치 때 깨워 두면 이후 자동 재생이 허용됨
const player = typeof Audio !== 'undefined' ? new Audio() : null;
if (player) { player.preload = 'auto'; player.setAttribute('playsinline', ''); }
let unlocked = false;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
export function unlockPlayer() {
  if (!player || unlocked) return;
  unlocked = true;
  try { player.src = SILENT; player.play().then(() => player.pause()).catch(() => { unlocked = false; }); } catch { unlocked = false; }
}

let currentUrl = '';
export async function playVoice(text: string, rate: number): Promise<{ model: string }> {
  if (!player) throw new TTSError('오디오 재생을 지원하지 않아요');
  const blob = await getVoice(text);
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  player.src = currentUrl;
  // 앱의 '보통'(0.9)이 Gemini 원래 속도
  player.playbackRate = Math.max(0.6, Math.min(1.4, rate / 0.9));
  (player as any).preservesPitch = true;
  (player as any).webkitPreservesPitch = true;
  await new Promise<void>((resolve, reject) => {
    const done = () => { player.onended = player.onerror = null; resolve(); };
    player.onended = done;
    player.onerror = () => { player.onended = player.onerror = null; reject(new TTSError('음성 파일을 재생하지 못했어요')); };
    player.play().catch((e) => { player.onended = player.onerror = null; reject(new TTSError(`재생이 막혔어요 (${e?.name ?? e})`)); });
  });
  return { model: workingModel || '저장된 음성' };
}

export function stopVoice() {
  if (player && !player.paused) { player.pause(); player.onended?.(new Event('ended')); }
}
