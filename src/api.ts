import type { Word } from './types';
import { sampleCap } from './platform';

// claude.ai 안: 사용자의 Claude 구독으로 호출 (키 불필요)
// 밖(독립 웹앱): Google Gemini API 무료 사용량으로 호출. 키는 이 휴대폰 브라우저에만 저장되고 구글로만 전송
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash']; // 앞에서부터 시도
const GEMINI_URL = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const WORD_SCHEMA = {
  type: 'object',
  properties: {
    word: { type: 'string', description: '문장에 나온 그대로의 형태' },
    lemma: { type: 'string', description: '사전 기본형' },
    pos: { type: 'string', description: '품사(한국어, 예: 동사, 명사, 숙어)' },
    ipa: { type: 'string', description: '미국식 IPA 발음기호' },
    meaning_ko: { type: 'string', description: '이 문장에서의 뜻(한국어)' },
    example_en: { type: 'string', description: '짧고 쉬운 다른 예문' },
  },
  required: ['word', 'lemma', 'pos', 'ipa', 'meaning_ko', 'example_en'],
  additionalProperties: false,
} as const;

const EXPRESSION_SCHEMA = {
  type: 'object',
  properties: {
    en: { type: 'string', description: '원어민이 실제로 말하는 가장 자연스러운 표현 한 문장' },
    alts: { type: 'array', items: { type: 'string' }, description: '다른 상황/격식에 맞는 대안 표현 0~2개' },
    note_ko: { type: 'string', description: '언제 쓰는지, 뉘앙스, 주의점(한국어 1~2문장)' },
    words: { type: 'array', items: WORD_SCHEMA, description: '대표 표현 en에 나온 단어/숙어 중 학습 가치가 있는 것' },
  },
  required: ['en', 'alts', 'note_ko', 'words'],
  additionalProperties: false,
} as const;

const SYSTEM = `당신은 한국인 직장인을 위한 영어 회화 코치입니다.
사용자가 한국어로 "영어로 이렇게 말하고 싶다"는 내용을 주면, 직역이 아니라 미국 원어민이 그 상황에서 실제로 쓰는 자연스럽고 기억하기 쉬운 표현을 만듭니다.
- en: 한 문장(길어도 20단어 이내). 말하기 연습용이므로 구어체를 우선합니다. 업무 상황이면 정중한 비즈니스 톤.
- alts: 더 캐주얼하거나 더 격식 있는 대안이 의미 있을 때만 최대 2개.
- words: en에 나온 단어 중 a, the, I, is 같은 아주 기초 단어를 제외한 단어와 숙어(구동사 포함)를 모두 포함합니다.`;

/** claude.ai 안에서는 Claude 구독으로, 밖에서는 Gemini 키로 */
export async function aiAvailable(key: string): Promise<boolean> {
  return !!(await sampleCap) || !!key;
}

/** 우리 JSON 스키마 → Gemini 스키마 (대문자 타입, additionalProperties 없음) */
function toGemini(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = { type: String(schema.type).toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGemini(v)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.items) out.items = toGemini(schema.items);
  if (schema.required) out.required = schema.required;
  return out;
}

export class AIError extends Error {}

let workingModel = ''; // 한 번 성공한 모델은 계속 사용

async function askGemini<T>(key: string, system: string, user: string, schema: object, maxTokens: number): Promise<T> {
  const models = workingModel ? [workingModel] : GEMINI_MODELS;
  let lastErr: Error | null = null;
  for (const m of models) {
    let res: Response;
    try {
      res = await fetch(GEMINI_URL(m), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: toGemini(schema), maxOutputTokens: maxTokens, temperature: 0.6 },
        }),
      });
    } catch {
      throw new AIError('인터넷 연결을 확인해 주세요.');
    }
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 404) { lastErr = new AIError(`모델을 찾을 수 없어요 (${m})`); continue; } // 다음 모델로
    if (!res.ok) {
      const reason = body?.error?.details?.find?.((d: any) => d.reason)?.reason ?? body?.error?.status ?? '';
      if (res.status === 400 && /API_KEY/.test(reason + JSON.stringify(body))) throw new AIError('Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.');
      if (res.status === 403) throw new AIError('이 키로는 Gemini를 쓸 수 없어요. Google AI Studio에서 키를 다시 확인해 주세요.');
      if (res.status === 429) throw new AIError('오늘 무료 사용량을 다 썼거나 너무 빨리 요청했어요. 잠시 후(또는 내일) 다시 시도해 주세요.');
      throw new AIError(`Gemini 오류(${res.status}). 잠시 후 다시 시도해 주세요.`);
    }
    workingModel = m;
    const cand = body?.candidates?.[0];
    if (!cand || cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') throw new AIError('이 요청은 처리할 수 없어요. 표현을 바꿔서 다시 시도해 주세요.');
    if (cand.finishReason === 'MAX_TOKENS') throw new AIError('응답이 너무 길어 잘렸어요. 문장을 짧게 나눠서 시도해 주세요.');
    const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AIError('답을 읽지 못했어요. 한 번 더 눌러 주세요.');
    }
  }
  throw lastErr ?? new AIError('Gemini에 연결하지 못했어요.');
}

async function askJSON<T>(key: string, system: string, user: string, schema: object, maxTokens: number): Promise<T> {
  const sample = await sampleCap;
  if (sample) {
    try {
      return (await sample.json(
        `${system}\n\n${user}\n\n다음 JSON 스키마에 맞는 JSON 하나만 답하세요:\n${JSON.stringify(schema)}`,
        { modelTier: 'default' },
      )) as T;
    } catch (e: any) {
      throw new Error(SAMPLE_ERRORS[e?.code] ?? e?.message ?? '요청에 실패했어요. 다시 시도해 주세요.');
    }
  }
  if (!key) throw new AIError('설정에서 Gemini API 키를 입력해 주세요.');
  return askGemini<T>(key, system, user, schema, maxTokens);
}

const SAMPLE_ERRORS: Record<string, string> = {
  not_granted: 'Claude 사용 권한이 꺼져 있어요. 페이지 메뉴의 권한에서 켜 주세요.',
  rate_limited: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  invalid_json: '답을 읽지 못했어요. 한 번 더 눌러 주세요.',
  cancelled: '취소됐어요.',
};

export interface Expression {
  en: string;
  alts: string[];
  note_ko: string;
  words: Word[];
}

export function generateExpression(key: string, ko: string): Promise<Expression> {
  return askJSON<Expression>(key, SYSTEM, `영어로 이렇게 말하고 싶어요:\n${ko}`, EXPRESSION_SCHEMA, 8192);
}

export function lookupWord(key: string, word: string, sentence: string): Promise<Word> {
  return askJSON<Word>(
    key,
    '당신은 한국인 학습자를 위한 영한 사전입니다. 주어진 문장 맥락에서의 뜻을 설명합니다.',
    `문장: ${sentence}\n단어: ${word}`,
    WORD_SCHEMA,
    2048,
  );
}

export function friendlyError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
