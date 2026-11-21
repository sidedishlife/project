// Gemini 무료 API 연결 (서버에서만 호출. 키는 Supabase 금고의 GEMINI_API_KEY)
const TEXT_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.0-flash'];
const TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-tts'];
const URL_FOR = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

export class AiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const geminiKey = () => Deno.env.get('GEMINI_API_KEY') ?? '';

const S = (description: string) => ({ type: 'STRING', description });
const WORD = {
  type: 'OBJECT',
  properties: {
    word: S('문장에 나온 그대로의 형태'), lemma: S('사전 기본형'), pos: S('품사(한국어, 예: 동사, 명사, 숙어)'),
    ipa: S('미국식 IPA 발음기호'), meaning_ko: S('이 문장에서의 뜻(한국어)'), example_en: S('짧고 쉬운 다른 예문'),
  },
  required: ['word', 'lemma', 'pos', 'ipa', 'meaning_ko', 'example_en'],
  propertyOrdering: ['word', 'lemma', 'pos', 'ipa', 'meaning_ko', 'example_en'],
};
const EXPRESSION = {
  type: 'OBJECT',
  properties: {
    en: S('원어민이 실제로 말하는 가장 자연스러운 표현 한 문장'),
    alts: { type: 'ARRAY', items: { type: 'STRING' }, description: '다른 상황/격식에 맞는 대안 표현 0~2개' },
    note_ko: S('언제 쓰는지, 뉘앙스, 주의점(한국어 1~2문장)'),
    words: { type: 'ARRAY', items: WORD, description: 'en에 나온 단어/숙어 중 학습 가치가 있는 것' },
  },
  required: ['en', 'alts', 'note_ko', 'words'],
  propertyOrdering: ['en', 'alts', 'note_ko', 'words'],
};
const EXPRESS_SYSTEM = `당신은 한국인 직장인을 위한 영어 회화 코치입니다.
사용자가 한국어로 "영어로 이렇게 말하고 싶다"는 내용을 주면, 직역이 아니라 미국 원어민이 그 상황에서 실제로 쓰는 자연스럽고 기억하기 쉬운 표현을 만듭니다.
- en: 한 문장(길어도 20단어 이내). 말하기 연습용이므로 구어체를 우선합니다. 업무 상황이면 정중한 비즈니스 톤.
- alts: 더 캐주얼하거나 더 격식 있는 대안이 의미 있을 때만 최대 2개.
- words: en에 나온 단어 중 a, the, I, is 같은 아주 기초 단어를 제외한 단어와 숙어(구동사 포함)를 모두 포함합니다.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 모델을 차례로 시도. 붐빔(503)은 한 번 더, 한도(429)·없는 모델(404)은 다음 모델로 */
async function call(models: string[], payload: unknown): Promise<{ body: any; model: string }> {
  const key = geminiKey();
  if (!key) throw new AiError(503, 'Gemini 키가 서버에 아직 없어요 (관리자 설정 필요)');
  let busy = 0, quota = 0, last = '';
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(URL_FOR(m), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (!res) { last = '연결 실패'; break; }
      const body: any = await res.json().catch(() => ({}));
      if (res.ok) return { body, model: m };
      last = `${m} ${res.status} ${body?.error?.message ?? ''}`.slice(0, 200);
      if (res.status === 503 || res.status === 500) { if (attempt === 0) { await sleep(1200); continue; } busy++; break; }
      if (res.status === 429) { quota++; break; }
      if (res.status === 404) break;
      if (res.status === 400 && /API key/i.test(last)) throw new AiError(502, 'Gemini 키가 올바르지 않아요 (관리자 확인 필요)');
      if (res.status === 403) throw new AiError(502, '이 키로는 Gemini를 쓸 수 없어요 (관리자 확인 필요)');
      break; // 그 밖의 400 등: 다음 모델로
    }
  }
  console.error('gemini all failed:', last);
  if (quota && !busy) throw new AiError(429, '오늘 Gemini 무료 사용량을 다 썼어요. 내일 다시 시도해 주세요');
  if (busy || quota) throw new AiError(503, '지금 Gemini 서버가 붐벼요. 1~2분 뒤 다시 시도해 주세요');
  throw new AiError(502, `Gemini 호출 실패 (${last})`);
}

function parseLoose(text: string): any {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  for (const t of [text, a >= 0 && b > a ? text.slice(a, b + 1) : '']) { try { return JSON.parse(t); } catch { /* 다음 */ } }
  return undefined;
}

async function askJSON(system: string, user: string, schema: object, maxTokens: number, parts: unknown[] = []) {
  const { body, model } = await call(TEXT_MODELS, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [...parts, { text: user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: maxTokens, temperature: 0.6 },
  });
  const cand = body?.candidates?.[0];
  if (!cand || ['SAFETY', 'PROHIBITED_CONTENT'].includes(cand.finishReason)) throw new AiError(422, '이 내용은 처리할 수 없어요. 표현을 바꿔 주세요');
  if (cand.finishReason === 'MAX_TOKENS') throw new AiError(422, '답이 너무 길어 잘렸어요. 문장을 짧게 나눠 주세요');
  const text = (cand.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('');
  const parsed = parseLoose(text);
  if (parsed === undefined) throw new AiError(502, '답을 읽지 못했어요. 한 번 더 눌러 주세요');
  return { data: parsed, model };
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export function normWord(w: any) {
  return { word: str(w?.word), lemma: str(w?.lemma || w?.word), pos: str(w?.pos), ipa: str(w?.ipa), meaning_ko: str(w?.meaning_ko), example_en: str(w?.example_en) };
}

/** 한국어 → 자연스러운 영어 표현 */
export async function express(ko: string) {
  const { data: r, model } = await askJSON(EXPRESS_SYSTEM, `영어로 이렇게 말하고 싶어요:\n${ko}`, EXPRESSION, 8192);
  const en = str(r?.en).trim();
  if (!en) throw new AiError(502, '영어 표현을 받지 못했어요. 한 번 더 눌러 주세요');
  return {
    en,
    alts: (Array.isArray(r?.alts) ? r.alts : []).map(str).filter(Boolean).slice(0, 2),
    note_ko: str(r?.note_ko),
    words: (Array.isArray(r?.words) ? r.words : []).map(normWord).filter((w: any) => w.word),
    model,
  };
}

/** 문장 속 단어 뜻 */
export async function lookup(word: string, sentence: string) {
  const { data, model } = await askJSON('당신은 한국인 학습자를 위한 영한 사전입니다. 주어진 문장 맥락에서의 뜻을 설명합니다.', `문장: ${sentence}\n단어: ${word}`, WORD, 2048);
  return { word: normWord(data), model };
}

/** 녹음한 한국어 → 글자 */
export async function transcribe(audioB64: string, mime: string) {
  const { data, model } = await askJSON(
    '녹음된 한국어 말을 그대로 받아 적습니다. 말한 내용만 적고 설명은 붙이지 않습니다. 말소리가 없으면 빈 문자열.',
    '이 녹음을 한국어 글자로 적어 주세요.',
    { type: 'OBJECT', properties: { text: S('받아 적은 한국어') }, required: ['text'] },
    1024,
    [{ inlineData: { mimeType: mime, data: audioB64 } }],
  );
  return { text: str(data?.text).trim(), model };
}

// ── 음성: PCM(16비트, 1채널) → WAV
function pcmToWav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) out[o + i] = t.charCodeAt(i); };
  s(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export const VOICE = 'Kore';
/** 영어 문장 → WAV 파일 바이트 */
export async function speak(text: string) {
  const { body, model } = await call(TTS_MODELS, {
    contents: [{ parts: [{ text: `Say clearly and naturally in American English: ${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
  });
  const part = body?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
  if (!part) throw new AiError(502, '음성이 비어 있어요. 다시 시도해 주세요');
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1]) || 24000;
  const pcm = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
  return { wav: pcmToWav(pcm, rate), model };
}
