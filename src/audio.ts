// 영어 음성 재생. 서버가 만든 음성 파일(WAV)을 일반 오디오로 재생 → 아이폰 무음 모드에서도 소리가 남
// 아이폰은 '사용자가 누른 순간'에 한 번 재생된 오디오 요소만 이후 자동 재생을 허락하므로, 하나의 요소를 계속 씀
import { api } from './api';

const player = new Audio();
player.preload = 'auto';
player.setAttribute('playsinline', '');

let unlocked = false;
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
/** 첫 터치 때 호출: 무음 파일을 한 번 재생해 오디오를 '깨워' 둠 */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  player.src = SILENT;
  player.play().then(() => player.pause()).catch(() => { unlocked = false; });
}

// 문장 → 음성 주소 (이 기기에도 기억해서 서버에 다시 묻지 않음)
const URLS_KEY = 'study.tts';
let urls: Record<string, string> = {};
try { urls = JSON.parse(localStorage.getItem(URLS_KEY) ?? '{}'); } catch { /* 무시 */ }
const inflight = new Map<string, Promise<string>>();
export function voiceUrl(text: string): Promise<string> {
  const t = text.trim();
  if (urls[t]) return Promise.resolve(urls[t]);
  let p = inflight.get(t);
  if (!p) {
    p = api.tts(t).then((u) => {
      urls[t] = u;
      try { localStorage.setItem(URLS_KEY, JSON.stringify(urls)); } catch { /* 무시 */ }
      return u;
    });
    inflight.set(t, p);
    p.finally(() => inflight.delete(t)).catch(() => {});
  }
  return p;
}
/** 미리 만들어 두기 (실패해도 조용히) */
export const prefetchVoice = (text: string) => { voiceUrl(text).catch(() => {}); };

let rate = 1;
try { rate = Number(localStorage.getItem('study.rate')) || 1; } catch { /* 무시 */ }
export const getRate = () => rate;
export function setRate(r: number) { rate = r; player.playbackRate = r; try { localStorage.setItem('study.rate', String(r)); } catch { /* 무시 */ } }

let session = 0; // 재생할 때마다 번호를 올려, 멈춘 재생이 뒤늦게 이어지지 않게 함

function playOnce(mySession: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('음성 파일을 재생하지 못했어요')); };
    const cleanup = () => { player.removeEventListener('ended', done); player.removeEventListener('error', fail); player.removeEventListener('pause', paused); };
    // 다른 재생이 시작돼 멈춘 경우
    const paused = () => { if (mySession !== session) { cleanup(); resolve(); } };
    player.addEventListener('ended', done);
    player.addEventListener('error', fail);
    player.addEventListener('pause', paused);
    player.currentTime = 0;
    player.playbackRate = rate;
    (player as any).preservesPitch = true;
    player.play().catch((e) => { cleanup(); reject(new Error(e?.name === 'NotAllowedError' ? '재생이 막혔어요. 화면을 한 번 누른 뒤 다시 눌러 주세요' : `재생 실패 (${e?.name ?? e})`)); });
  });
}

/**
 * 문장을 times번 이어서 재생. 한 번 끝날 때마다 onEach(몇 번째)를 부름
 * 반환값: 실제로 끝까지 들은 횟수
 */
export async function playTimes(text: string, times: number, onEach?: (n: number) => void, gapMs = 700): Promise<number> {
  const mine = ++session;
  const url = await voiceUrl(text);
  if (mine !== session) return 0;
  if (player.src !== url) { player.src = url; player.load(); }
  let heard = 0;
  for (let i = 0; i < times; i++) {
    if (mine !== session) break;
    await playOnce(mine);
    if (mine !== session) break;
    heard++;
    onEach?.(heard);
    if (i < times - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return heard;
}

export function stopAudio() {
  session++;
  if (!player.paused) player.pause();
}
export const isPlaying = () => !player.paused;
