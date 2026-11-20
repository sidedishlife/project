import Anthropic from '@anthropic-ai/sdk';
import type { Word } from './types';

const MODEL = 'claude-opus-5-5';

// 개인용 앱: API 키는 이 기기의 브라우저 저장소에만 보관되고 Anthropic API로만 전송된다.
function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

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

async function askJSON<T>(apiKey: string, system: string, user: string, schema: object, maxTokens: number): Promise<T> {
  const res = await client(apiKey).beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
    // 안전 분류기가 드물게 요청을 거절하면 서버가 다른 모델로 자동 재시도
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw new Error('이 요청은 처리할 수 없어요. 표현을 바꿔서 다시 시도해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 잘렸어요. 문장을 짧게 나눠서 시도해 주세요.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return JSON.parse(text) as T;
}

export interface Expression {
  en: string;
  alts: string[];
  note_ko: string;
  words: Word[];
}

export function generateExpression(apiKey: string, ko: string): Promise<Expression> {
  return askJSON<Expression>(apiKey, SYSTEM, `영어로 이렇게 말하고 싶어요:\n${ko}`, EXPRESSION_SCHEMA, 4000);
}

export function lookupWord(apiKey: string, word: string, sentence: string): Promise<Word> {
  return askJSON<Word>(
    apiKey,
    '당신은 한국인 학습자를 위한 영한 사전입니다. 주어진 문장 맥락에서의 뜻을 설명합니다.',
    `문장: ${sentence}\n단어: ${word}`,
    WORD_SCHEMA,
    1000,
  );
}

export function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. 설정에서 확인해 주세요.';
  if (e instanceof Anthropic.RateLimitError) return '요청이 많아요. 잠시 후 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIConnectionError) return '인터넷 연결을 확인해 주세요.';
  if (e instanceof Anthropic.APIError) return `서버 오류(${e.status ?? ''}). 잠시 후 다시 시도해 주세요.`;
  return e instanceof Error ? e.message : String(e);
}
