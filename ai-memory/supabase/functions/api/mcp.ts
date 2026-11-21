// 상태 없는 MCP(Streamable HTTP, JSON 응답) — 외부 SDK 없이 최소 JSON-RPC 2.0
import type { CandidateInput } from './types.ts';

export type Source = 'claude' | 'chatgpt';
export type Submit = (
  source: Source,
  items: CandidateInput[],
) => Promise<{ created: number; skipped_duplicates: number; over_limit: number }>;

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const KINDS = ['explain', 'apply', 'compare'];

const TOOL = {
  name: 'save_to_memory',
  description:
    "사용자가 '기억장에 저장해'라고 하면 호출. 이 대화의 핵심 업무 개념을 최대 3개까지, 각각 해설 노트(마크다운, 사용자가 다시 읽어도 이해되게)와 질문 2~3개(explain/apply는 EPC 업무 상황/compare)로 정리해 보낸다. " +
    "Call when the user says to save to their memory notebook. Send up to 3 key work concepts from this conversation, each with a self-contained markdown explanation note and 2-3 questions (explain/apply in an EPC work situation/compare).",
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '개념 이름' },
            note_md: { type: 'string', description: '해설 노트 (마크다운)' },
            questions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: KINDS },
                  prompt: { type: 'string' },
                },
                required: ['kind', 'prompt'],
              },
            },
            field_hint: { type: 'string', description: '분야 (선택)' },
          },
          required: ['title', 'note_md', 'questions'],
        },
      },
    },
    required: ['items'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

type Id = string | number | null;
const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolText = (text: string, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 도구 인자 검사. 올바르면 후보 목록, 아니면 한국어 오류 문장 */
function parseItems(args: unknown): CandidateInput[] | string {
  if (!isObj(args) || !Array.isArray(args.items) || args.items.length === 0) return 'items에 저장할 개념을 1개 이상 목록으로 넣어 주세요.';
  const out: CandidateInput[] = [];
  for (const [i, it] of args.items.entries()) {
    const n = `items[${i}]`;
    if (!isObj(it)) return `${n}는 객체여야 해요.`;
    if (!nonEmpty(it.title)) return `${n}.title(개념 이름)이 비어 있어요.`;
    if (!nonEmpty(it.note_md)) return `${n}.note_md(해설 노트)가 비어 있어요.`;
    if (!Array.isArray(it.questions) || it.questions.length === 0) return `${n}.questions에 질문을 1개 이상 넣어 주세요.`;
    if (it.field_hint !== undefined && typeof it.field_hint !== 'string') return `${n}.field_hint는 문자열이어야 해요.`;
    const questions: CandidateInput['questions'] = [];
    for (const [j, q] of it.questions.entries()) {
      if (!isObj(q) || !KINDS.includes(q.kind as string)) return `${n}.questions[${j}].kind는 explain/apply/compare 중 하나여야 해요.`;
      if (!nonEmpty(q.prompt)) return `${n}.questions[${j}].prompt가 비어 있어요.`;
      questions.push({ kind: q.kind as CandidateInput['questions'][number]['kind'], prompt: q.prompt });
    }
    out.push({ title: it.title, note_md: it.note_md, questions, ...(it.field_hint ? { field_hint: it.field_hint } : {}) });
  }
  return out;
}

/** JSON-RPC 요청 하나를 처리. 알림(id 없음)이면 null */
export async function handleMcp(body: unknown, source: Source, submit: Submit): Promise<object | null> {
  if (!isObj(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return err(null, -32600, 'Invalid Request');
  const hasId = 'id' in body;
  const id = (hasId ? body.id : null) as Id;
  if (!hasId) return null; // 알림
  const params = isObj(body.params) ? body.params : {};

  switch (body.method) {
    case 'initialize': {
      const v = params.protocolVersion;
      return ok(id, {
        protocolVersion: typeof v === 'string' && PROTOCOLS.includes(v) ? v : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-memory', version: '1.0.0' },
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: [TOOL] });
    case 'tools/call': {
      if (params.name !== TOOL.name) return err(id, -32602, `Unknown tool: ${String(params.name)}`);
      const items = parseItems(params.arguments);
      if (typeof items === 'string') return ok(id, toolText(`저장하지 못했어요. ${items}`, true));
      try {
        const r = await submit(source, items);
        let text = `받은함에 ${r.created}개 추가(중복 ${r.skipped_duplicates}개 제외). 앱 받은함에서 확정해 주세요.`;
        if (r.over_limit > 0) text += ` (한 번에 3개까지만 받아서 ${r.over_limit}개는 제외했어요.)`;
        return ok(id, toolText(text));
      } catch (e) {
        console.error(e);
        return ok(id, toolText('저장 중에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.', true));
      }
    }
    default:
      return err(id, -32601, `Method not found: ${body.method}`);
  }
}

/** 길이가 달라도 시간이 새지 않게 비교(해시 후 XOR) */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const JSON_H = { 'Content-Type': 'application/json' };

/**
 * /mcp/:secret 요청 처리. 앱 로그인 없이 경로의 비밀값이 인증이다.
 * expectedSecret이 비어 있거나 없으면 404.
 */
export async function handleMcpRequest(req: Request, pathSecret: string, expectedSecret: string | null | undefined, submit: Submit): Promise<Response> {
  const notFound = () => new Response(JSON.stringify({ error: '없는 경로예요' }), { status: 404, headers: JSON_H });
  const authed = typeof expectedSecret === 'string' && expectedSecret.length > 0;
  const match = await safeEqual(pathSecret, authed ? expectedSecret : '');
  if (!authed || !match) return notFound();
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } }); // 상태 없음: SSE·세션 종료 없음
  const source: Source = new URL(req.url).searchParams.get('from') === 'chatgpt' ? 'chatgpt' : 'claude';
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify(err(null, -32700, 'Parse error')), { status: 200, headers: JSON_H });
  }
  const res = await handleMcp(body, source, submit);
  if (res === null) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(res), { status: 200, headers: JSON_H });
}
