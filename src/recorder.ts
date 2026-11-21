// 🎙️ 한국어 녹음 → 서버(Gemini)가 글자로 받아 적음
import { api } from './api';

let rec: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let timer = 0;

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
export const isRecording = () => rec?.state === 'recording';

function pickMime() {
  // 아이폰 사파리는 mp4, 안드로이드 크롬은 webm
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

export async function startRecording(maxMs = 60_000, onAutoStop?: () => void) {
  if (!recordingSupported()) throw new Error('이 브라우저는 녹음을 지원하지 않아요');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    throw new Error(e?.name === 'NotAllowedError' ? '마이크 권한이 꺼져 있어요. 설정에서 이 사이트의 마이크를 허용해 주세요' : '마이크를 켜지 못했어요');
  }
  const mime = pickMime();
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  timer = window.setTimeout(() => { if (isRecording()) onAutoStop?.(); }, maxMs);
}

/** 녹음을 멈추고 받아 적은 글자를 돌려줌 */
export async function stopAndTranscribe(lang: 'ko' | 'en' = 'ko'): Promise<string> {
  clearTimeout(timer);
  const r = rec;
  if (!r) return '';
  const stopped = new Promise<void>((res) => { r.onstop = () => res(); });
  if (r.state !== 'inactive') r.stop();
  await stopped;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null; rec = null;
  const blob = new Blob(chunks, { type: r.mimeType || 'audio/mp4' });
  if (blob.size < 1000) throw new Error('녹음이 너무 짧아요. 버튼을 누르고 말한 뒤 다시 눌러 주세요');
  const b64 = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => rej(new Error('녹음을 읽지 못했어요'));
    fr.readAsDataURL(blob);
  });
  const text = await api.transcribe(b64, blob.type, lang);
  if (!text) throw new Error('말소리를 알아듣지 못했어요. 조금 더 크게 말해 주세요');
  return text;
}

export function cancelRecording() {
  clearTimeout(timer);
  if (rec && rec.state !== 'inactive') rec.stop();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null; rec = null;
}
