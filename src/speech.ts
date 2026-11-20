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

export const ttsSupported = () => 'speechSynthesis' in window;

export function speak(text: string, rate = 0.9): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}

type Rec = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void;
  start(): void; stop(): void;
};
const RecCtor: (new () => Rec) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const sttSupported = () => !!RecCtor;

/** 한국어 음성 → 텍스트 */
export function listenKorean(onPartial?: (t: string) => void): Promise<string> {
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
