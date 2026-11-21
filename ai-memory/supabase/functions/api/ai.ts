// 서버 AI (Anthropic API 전용). 모든 함수는 실패·거절 시 null을 돌려주고 예외를 던지지 않는다.
import type { Grade } from './srs.ts';
import type { CandidateInput } from './types.ts';

// deno-lint-ignore no-explicit-any
export type AnthropicLike = { messages: { create(params: any): Promise<any> } };
export interface AiOpts { client?: AnthropicLike; model?: string }

const SDK = 'npm:@anthropic-ai/sdk@1.10.0';
let cached: AnthropicLike | undefined;

async function defaultClient(): Promise<AnthropicLike> {
  if (!cached) {
    const { default: Anthropic } = await import(SDK);
    cached = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }) as AnthropicLike;
  }
  return cached;
}

async function defaultModel(): Promise<string> {
  const { config } = await import('./db.ts'); // 지연 로드: 테스트는 model을 주입해 DB를 건드리지 않는다
  return (await config(['ai_model'])).ai_model;
}

// deno-lint-ignore no-explicit-any
type SystemArg = string | any[];

export async function callJson<T>(system: SystemArg, user: string, schema: object, opts: AiOpts = {}): Promise<T | null> {
  try {
    const client = opts.client ?? await defaultClient();
    const model = opts.model ?? await defaultModel();
    const res = await client.messages.create({
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    });
    if (res?.stop_reason === 'refusal' || res?.stop_reason === 'max_tokens') return null;
    // deno-lint-ignore no-explicit-any
    const block = (res?.content ?? []).find((b: any) => b?.type === 'text');
    if (!block || typeof block.text !== 'string') return null;
    return JSON.parse(block.text) as T;
  } catch (e) {
    console.error('ai call failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

const str = { type: 'string' };
const strs = { type: 'array', items: str };
const obj = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

// ── matchConcept ──
export interface MatchResult { action: 'merge' | 'new' | 'pair'; target_id: string | null; reason: string }
const MATCH_SCHEMA = obj({
  action: { type: 'string', enum: ['merge', 'new', 'pair'] },
  target_id: { type: ['string', 'null'] },
  reason: str,
});
const MATCH_SYSTEM = `너는 개인 학습 노트 정리 도우미야. 새 후보 개념이 기존 개념 목록과 어떤 관계인지 판단해.
- 같은 개념이면 action="merge" (target_id는 목록의 id).
- 다르지만 헷갈리기 쉬운 이웃 개념이면 action="pair" (target_id는 그 이웃의 id).
- 그 외에는 action="new" (target_id는 null).
이름만 비슷하고 실제로 다른 개념(예: P&ID와 PFD)은 merge 하지 말고, 헷갈리기 쉬우면 pair로 해.
reason은 한국어 한 문장.

기존 개념 목록(제목 + 노트 앞 200자):
`;

export async function matchConcept(
  cand: { title: string; note_md: string },
  existing: { id: string; title: string; summary: string }[],
  opts?: AiOpts,
): Promise<MatchResult | null> {
  // 캐싱 적중을 위해 id 순으로 고정
  const list = [...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => `- id=${c.id} | ${c.title} | ${c.summary.slice(0, 200).replace(/\s+/g, ' ')}`).join('\n') || '(없음)';
  const system = [{ type: 'text', text: MATCH_SYSTEM + list, cache_control: { type: 'ephemeral' } }];
  const r = await callJson<MatchResult>(system, `후보 개념\n제목: ${cand.title}\n노트:\n${cand.note_md}`, MATCH_SCHEMA, opts);
  if (!r || !['merge', 'new', 'pair'].includes(r.action)) return null;
  if (r.action !== 'new' && !existing.some((c) => c.id === r.target_id)) return null;
  return { action: r.action, target_id: r.action === 'new' ? null : r.target_id, reason: String(r.reason ?? '') };
}

// ── mergeNote ──
export async function mergeNote(oldNote: string, addition: string, opts?: AiOpts): Promise<{ note_md: string; changes: string[] } | null> {
  const r = await callJson<{ note_md: string; changes: string[] }>(
    '너는 노트 편집자야. 기존 노트에 추가 내용을 자연스럽게 합쳐 하나의 마크다운 노트로 만들어. 중복은 제거하고 기존의 핵심 내용은 잃지 마. changes에는 무엇을 바꿨는지 한국어 짧은 문장으로 적어.',
    `기존 노트:\n${oldNote}\n\n추가할 내용:\n${addition}`,
    obj({ note_md: str, changes: strs }),
    opts,
  );
  if (!r || typeof r.note_md !== 'string' || !Array.isArray(r.changes)) return null;
  return r;
}

// ── gradeAnswer ──
export async function gradeAnswer(question: string, note_md: string, answer: string, opts?: AiOpts) {
  const r = await callJson<{ grade: Grade; hit: string[]; missed: string[]; comment: string }>(
    `너는 복습 채점자야. 노트의 핵심 요소를 뽑고, 사용자의 답변이 맞힌 것(hit)과 빠진 것(missed)을 나눠.
핵심 대부분을 맞혔으면 grade="good", 절반 정도면 "hard", 그 이하면 "again". comment는 한국어 한두 문장.`,
    `질문: ${question}\n\n노트:\n${note_md}\n\n사용자 답변:\n${answer}`,
    obj({ grade: { type: 'string', enum: ['good', 'hard', 'again'] }, hit: strs, missed: strs, comment: str }),
    opts,
  );
  if (!r || !['good', 'hard', 'again'].includes(r.grade) || !Array.isArray(r.hit) || !Array.isArray(r.missed)) return null;
  return r;
}

// ── compareQuestion ──
export async function compareQuestion(a: { title: string; note_md: string }, b: { title: string; note_md: string }, opts?: AiOpts): Promise<string | null> {
  const r = await callJson<{ question: string }>(
    '너는 복습 문제 출제자야. 두 개념의 차이를 구분해서 설명하게 만드는 한국어 질문 하나를 만들어. 답은 알려주지 마.',
    `개념 A: ${a.title}\n${a.note_md}\n\n개념 B: ${b.title}\n${b.note_md}`,
    obj({ question: str }),
    opts,
  );
  return r && typeof r.question === 'string' && r.question.trim() ? r.question : null;
}

// ── extractCandidates ──
const CAND_SCHEMA = obj({
  candidates: {
    type: 'array',
    items: obj({
      title: str,
      note_md: str,
      questions: { type: 'array', items: obj({ kind: { type: 'string', enum: ['explain', 'apply', 'compare'] }, prompt: str }) },
      field_hint: str,
    }),
  },
});

export async function extractCandidates(text: string, opts?: AiOpts): Promise<CandidateInput[] | null> {
  const r = await callJson<{ candidates: (CandidateInput & { field_hint?: string })[] }>(
    `너는 학습 노트 추출기야. 붙여넣은 대화에서 나중에 복습할 가치가 있는 개념 후보를 최대 3개 뽑아.
각 후보: title(개념 이름), note_md(핵심만 간결한 마크다운 노트), questions(explain=설명, apply=적용, compare=비교 유형의 복습 질문 1~3개, 답은 포함하지 마), field_hint(분야 힌트, 모르면 빈 문자열). 모두 한국어.`,
    text,
    CAND_SCHEMA,
    opts,
  );
  if (!r || !Array.isArray(r.candidates)) return null;
  return r.candidates.slice(0, 3).map((c) => ({
    title: c.title,
    note_md: c.note_md,
    questions: c.questions,
    ...(c.field_hint ? { field_hint: c.field_hint } : {}),
  }));
}
