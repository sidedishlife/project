import { ttsCap, dictationCap } from './platform';

// ───────────────────────── 음성 출력(TTS) ─────────────────────────
// 1순위: 브라우저 내장 음성(무료, 속도 조절)  2순위: claude.ai의 Claude 음성
// 둘 다 안 되면 'speech-unavailable' 이벤트로 화면에 안내
let voice: SpeechSynthesisVoice | null = null;
let tts: any = null;
ttsCap.then((t) => (tts = t));
let dictation: any = null;
dictationCap.then((d) => (dictation = d));

const hasSynth = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
let synthBroken = false; // 말하기를 시도했는데 소리가 시작되지 않은 적이 있음

function pickVoice() {
  if (!hasSynth()) return;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const prefer = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Karen', 'Daniel'];
  voice =
    prefer.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices[0] ??
    null;
}
if (hasSynth()) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export type Engine = 'browser' | 'claude' | 'none';
export function speechEngine(): Engine {
  if (hasSynth() && !synthBroken) return 'browser';
  if (tts) return 'claude';
  return 'none';
}
export const ttsSupported = () => speechEngine() !== 'none';

/** 첫 터치 때 한 번: iOS는 사용자의 탭 안에서 소리를 한 번 내야 이후 자동 재생을 허용함 */
let unlocked = false;
export function unlockSpeech() {
  if (unlocked || !hasSynth()) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    pickVoice();
  } catch { /* 무시 */ }
}

function notifyUnavailable() {
  window.dispatchEvent(new CustomEvent('speech-unavailable'));
}

function speakWithClaude(text: string, rate: number): Promise<void> {
  return tts.speak(text, { rate: Math.max(0.7, Math.min(1.5, rate)), language: 'en' }).catch(() => {});
}

export function speak(text: string, rate = 0.9): Promise<void> {
  const engine = speechEngine();
  if (engine === 'claude') return speakWithClaude(text, rate);
  if (engine === 'none') {
    notifyUnavailable();
    return new Promise((r) => setTimeout(r, 600));
  }
  return new Promise((resolve) => {
    let started = false;
    const done = () => { clearTimeout(guard); clearTimeout(startCheck); resolve(); };
    // 일부 모바일 브라우저는 onend를 보내지 않으므로 안전장치
    const guard = setTimeout(done, 2500 + (text.length * 110) / rate);
    // 2.5초 안에 소리가 시작되지 않으면 이 화면에서는 음성이 막힌 것
    const startCheck = setTimeout(() => {
      if (started) return;
      synthBroken = true;
      speechSynthesis.cancel();
      if (tts) speakWithClaude(text, rate).then(done);
      else { notifyUnavailable(); done(); }
    }, 2500);
    try {
      speechSynthesis.cancel();
      if (speechSynthesis.paused) speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      if (voice) u.voice = voice;
      u.onstart = () => { started = true; };
      u.onend = () => { started = true; done(); };
      u.onerror = (e) => {
        if ((e as SpeechSynthesisErrorEvent).error === 'interrupted' || (e as SpeechSynthesisErrorEvent).error === 'canceled') { started = true; return done(); }
        started = true;
        synthBroken = true;
        if (tts) speakWithClaude(text, rate).then(done);
        else { notifyUnavailable(); done(); }
      };
      speechSynthesis.speak(u);
    } catch {
      synthBroken = true;
      notifyUnavailable();
      done();
    }
  });
}

export function stopSpeaking() {
  if (hasSynth()) speechSynthesis.cancel();
  tts?.stop?.();
}

// ───────────────────────── 음성 입력(STT) ─────────────────────────
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
    if (!RecCtor) return reject(new Error('이 화면은 음성 입력을 지원하지 않아요. 키보드의 마이크 버튼을 이용해 주세요.'));
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
    r.onerror = (e: any) => reject(new Error(e.error === 'not-allowed' ? '마이크 권한이 필요해요. 키보드의 마이크 버튼을 이용해 주세요.' : `음성 인식 오류: ${e.error}`));
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

export function stopListening() {
  dictation?.stop?.().catch(() => {});
}
