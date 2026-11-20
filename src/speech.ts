import { ttsCap, dictationCap } from './platform';

// 음성 출력(TTS)과 음성 입력(STT): 브라우저 내장 기능만 사용 → 무료, 오프라인 TTS 가능
let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  const prefer = ['Samantha', 'Google US English', 'Microsoft Aria', 'Karen', 'Daniel'];
  voice =
    prefer.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices[0] ??
    null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

let tts: any = null;
ttsCap.then((t) => (tts = t));
let dictation: any = null;
dictationCap.then((d) => (dictation = d));

const hasBrowserVoices = () => 'speechSynthesis' in window && speechSynthesis.getVoices().some((v) => v.lang.startsWith('en'));
export const ttsSupported = () => 'speechSynthesis' in window || !!tts;

export function speak(text: string, rate = 0.9): Promise<void> {
  // 브라우저 영어 음성이 없으면 Claude 음성(tts)으로
  if (tts && !hasBrowserVoices()) {
    return tts.speak(text, { rate: Math.max(0.7, Math.min(1.5, rate)), language: 'en' }).catch(() => {});
  }
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    // 일부 모바일 브라우저는 onend를 안 보내므로 안전장치
    const guard = setTimeout(resolve, 1500 + text.length * 120 / rate);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    if (voice) u.voice = voice;
    u.onend = () => { clearTimeout(guard); resolve(); };
    u.onerror = () => { clearTimeout(guard); resolve(); };
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  tts?.stop?.();
}

type Rec = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void;
  start(): void; stop(): void;
};
const RecCtor: (new () => Rec) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const sttSupported = () => !!dictation || !!RecCtor;

/** 한국어 음성 → 텍스트 */
export function listenKorean(onPartial?: (t: string) => void): Promise<string> {
  if (dictation) return listenWithDictation(onPartial);
  return new Promise((resolve, reject) => {
    if (!RecCtor) return reject(new Error('이 브라우저는 음성 입력을 지원하지 않아요. 키보드의 마이크 버튼을 이용해 주세요.'));
    const r = new RecCtor();
    r.lang = 'ko-KR';
    r.interimResults = true;
    r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      finalText = t;
      onPartial?.(t);
    };
    r.onerror = (e: any) => reject(new Error(e.error === 'not-allowed' ? '마이크 권한이 필요해요.' : `음성 인식 오류: ${e.error}`));
    r.onend = () => resolve(finalText.trim());
    r.start();
  });
}

/** claude.ai 받아쓰기: 클릭 핸들러에서 바로 start() 해야 함 */
function listenWithDictation(onPartial?: (t: string) => void): Promise<string> {
  const d = dictation;
  let done = '';
  let live = '';
  return new Promise((resolve, reject) => {
    const offs = [
      d.onPartial(({ text }: { text: string }) => { live = text; onPartial?.((done + ' ' + live).trim()); }),
      d.onFinal(({ text }: { text: string }) => { done = (done + ' ' + text).trim(); live = ''; onPartial?.(done); }),
      d.onState(({ state }: { state: string }) => {
        if (state === 'idle') { offs.forEach((f: () => void) => f()); resolve(done.trim()); }
      }),
    ];
    d.start({ language: 'ko' }).catch((e: any) => {
      offs.forEach((f: () => void) => f());
      reject(new Error(e?.code === 'not_granted' ? '마이크 사용이 거부됐어요. 키보드의 마이크 버튼을 이용해 주세요.' : '음성 입력을 쓸 수 없어요. 키보드의 마이크 버튼을 이용해 주세요.'));
    });
  });
}

/** 받아쓰기 중지(사용자가 다시 누를 때) */
export function stopListening() {
  dictation?.stop?.().catch(() => {});
}
