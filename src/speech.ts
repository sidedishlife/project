import { ttsCap, dictationCap } from './platform';

// ───────────────────────── 음성 출력(TTS) ─────────────────────────
// '자동'이면: claude.ai의 Claude 음성(이 화면 전용으로 만들어진 소리)이 있으면 그것부터,
// 없으면(사파리·모바일 앱) 휴대폰 내장 음성. 둘 다 안 되면 'speech-unavailable' 이벤트로 화면에 안내
let voice: SpeechSynthesisVoice | null = null;
let tts: any = null;
ttsCap.then((t) => (tts = t));
let dictation: any = null;
dictationCap.then((d) => (dictation = d));

const hasSynth = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

// 아이폰: 무음 스위치가 켜져 있어도 이 페이지 소리는 나도록 요청 (iOS 17+ 사파리)
try { (navigator as any).audioSession && ((navigator as any).audioSession.type = 'playback'); } catch { /* 미지원 */ }

/** 진단용 기록: 설정 › 소리 점검에 그대로 보여줌 */
export const diag = {
  last: '아직 재생 안 함',
  okCount: 0,
  failCount: 0,
};
let failStreak = 0; // 브라우저 음성이 연속으로 실패한 횟수 (성공하면 0)
let current: SpeechSynthesisUtterance | null = null; // 재생 중 객체를 붙잡아 둠 (크롬이 중간에 지우는 버그 방지)

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
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let voiceName = ''; // 사용자가 고른 목소리 이름 ('' = 자동)
export const setVoiceName = (n: string) => { voiceName = n; };
/** 아이폰은 이름으로 고른 목소리가 실제로는 내려받지 않은 상태일 수 있어, 따로 고르지 않으면 시스템에 맡김 */
function chosenVoice(): SpeechSynthesisVoice | null {
  if (voiceName) return speechSynthesis.getVoices().find((v) => v.name === voiceName) ?? null;
  return isIOS ? null : voice;
}
/** 고를 수 있는 영어 목소리 목록 */
export function englishVoices(): { name: string; lang: string; local: boolean }[] {
  if (!hasSynth()) return [];
  return speechSynthesis.getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
}
export const currentVoiceName = () => voiceName;

export type Engine = 'browser' | 'claude' | 'none';
export type VoicePref = 'auto' | 'claude' | 'device';
let pref: VoicePref = 'auto';
export const setVoicePref = (p: VoicePref) => { pref = p; failStreak = 0; };
export const claudeVoiceAvailable = () => !!tts;

/** 지금 쓸 엔진 */
export function speechEngine(): Engine {
  const device = hasSynth() && failStreak < 2;
  if (pref === 'device') return hasSynth() ? 'browser' : tts ? 'claude' : 'none';
  if (tts) return 'claude'; // 자동·Claude: Claude 음성이 있으면 우선
  if (device || hasSynth()) return 'browser';
  return 'none';
}
export const ttsSupported = () => speechEngine() !== 'none';

/** 첫 터치 때: 모바일은 사용자가 누른 순간 안에서 음성 엔진을 한 번 깨워야 이후 재생을 허용함 */
let unlocked = false;
let unlockUtterance: SpeechSynthesisUtterance | null = null;
export function unlockSpeech() {
  if (unlocked || !hasSynth()) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0.01;
    u.lang = 'en-US';
    unlockUtterance = u;
    u.onend = u.onerror = () => { if (unlockUtterance === u) unlockUtterance = null; };
    speechSynthesis.speak(u);
    pickVoice();
  } catch { /* 무시 */ }
}

function notifyUnavailable() {
  window.dispatchEvent(new CustomEvent('speech-unavailable'));
}

function speakWithClaude(text: string, rate: number): Promise<void> {
  return tts
    .speak(text, { rate: Math.max(0.7, Math.min(1.5, rate)), language: 'en' })
    .then(() => { diag.last = 'Claude 음성으로 재생 성공'; diag.okCount++; })
    .catch((e: any) => {
      const code = e?.code ?? String(e);
      diag.last = `Claude 음성 실패: ${code}`;
      diag.failCount++;
      // 사용자가 멈춘 게 아니면 휴대폰 음성으로 한 번 더
      if (code !== 'viewer_stopped' && code !== 'cancelled' && hasSynth()) return speakWithDevice(text, rate);
    });
}

export function speak(text: string, rate = 0.9): Promise<void> {
  const engine = speechEngine();
  if (engine === 'claude') return speakWithClaude(text, rate);
  if (engine === 'none') {
    diag.last = '이 화면에는 음성 기능이 없음';
    diag.failCount++;
    notifyUnavailable();
    return new Promise((r) => setTimeout(r, 600));
  }
  return speakWithDevice(text, rate);
}

function speakWithDevice(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    let started = false;
    let finished = false;
    const done = () => { if (finished) return; finished = true; clearTimeout(guard); clearTimeout(startCheck); resolve(); };
    const fail = (why: string) => {
      diag.last = why;
      diag.failCount++;
      failStreak++;
      if (tts && pref !== 'device') speakWithClaude(text, rate).then(done);
      else { notifyUnavailable(); done(); }
    };
    // 일부 모바일 브라우저는 끝났다는 신호를 안 보내므로 안전장치
    const guard = setTimeout(done, 3000 + (text.length * 110) / rate);
    // 3초 안에 소리가 시작되지 않으면 이번 재생은 실패로 봄 (다음엔 다시 시도)
    const startCheck = setTimeout(() => { if (!started) fail('3초 안에 소리가 시작되지 않음'); }, 3000);
    const start = () => {
    try {
      if (speechSynthesis.paused) speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance(text);
      current = u;
      u.lang = 'en-US';
      u.rate = rate;
      u.volume = 1;
      const chosen = chosenVoice();
      if (chosen) { try { u.voice = chosen; } catch { /* 목소리 지정 실패 시 시스템 기본 */ } }
      const label = chosen?.name ?? '시스템 기본 영어 음성';
      let t0 = 0;
      window.dispatchEvent(new CustomEvent('speech-start'));
      u.onstart = () => {
        started = true;
        failStreak = 0;
        t0 = performance.now();
        diag.last = `재생 시작 (${label})`;
        diag.okCount++;
      };
      u.onend = () => {
        started = true;
        if (current === u) current = null;
        // 실제로 읽었다면 문장 길이만큼 시간이 걸림. 너무 빨리 끝나면 소리 없이 끝난 것
        const sec = t0 ? (performance.now() - t0) / 1000 : 0;
        const expect = Math.max(0.6, (text.split(/\s+/).length * 0.3) / rate);
        diag.last = sec < expect * 0.4
          ? `소리 없이 끝남: ${sec.toFixed(1)}초 (${label}) → 다른 목소리를 골라 보세요`
          : `읽기 완료: ${sec.toFixed(1)}초 (${label})`;
        window.dispatchEvent(new CustomEvent('speech-end'));
        done();
      };
      u.onerror = (e) => {
        const code = (e as SpeechSynthesisErrorEvent).error;
        window.dispatchEvent(new CustomEvent('speech-end'));
        if (code === 'interrupted' || code === 'canceled') { started = true; return done(); }
        clearTimeout(startCheck);
        fail(`브라우저 음성 오류: ${code}`);
      };
      speechSynthesis.speak(u);
    } catch (e) {
      clearTimeout(startCheck);
      fail(`브라우저 음성 오류: ${e}`);
    }
    };
    // 다른 문장이 나오는 중이면 멈추고 잠깐 뒤에 시작 (멈춘 즉시 재생하면 소리가 씹히는 브라우저가 있음)
    // 첫 터치 때 깨우려고 낸 무음 소리는 멈추지 않고 뒤에 이어서 재생
    const busy = (speechSynthesis.speaking || speechSynthesis.pending) && !unlockUtterance;
    if (busy) { speechSynthesis.cancel(); setTimeout(start, 120); }
    else start();
  });
}

export function stopSpeaking() {
  if (hasSynth() && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
  tts?.stop?.();
}

/** 설정 › 소리 점검에 보여줄 정보 */
export function soundReport() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const android = /Android/.test(ua);
  const inApp = (android && /; wv\)/.test(ua)) || (ios && !/Safari\//.test(ua)) || /Claude/i.test(ua);
  const voices = hasSynth() ? speechSynthesis.getVoices() : [];
  return {
    device: ios ? '아이폰/아이패드' : android ? '안드로이드' : '컴퓨터',
    place: inApp ? '앱 안 화면' : '브라우저',
    synth: hasSynth(),
    voices: voices.length,
    enVoices: voices.filter((v) => v.lang.toLowerCase().startsWith('en')).length,
    claude: !!tts,
    engine: speechEngine(),
    last: diag.last,
    ok: diag.okCount,
    fail: diag.failCount,
  };
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
