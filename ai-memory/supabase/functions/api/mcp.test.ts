import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handleMcp, handleMcpRequest, type Submit } from './mcp.ts';

const item = { title: '개념', note_md: '노트', questions: [{ kind: 'explain', prompt: '질문' }] };
const fake = () => {
  const calls: { source: string; items: unknown[] }[] = [];
  const submit: Submit = (source, items) => {
    calls.push({ source, items });
    return Promise.resolve({ created: items.length, skipped_duplicates: 0, over_limit: 0 });
  };
  return { calls, submit };
};
// deno-lint-ignore no-explicit-any
type R = any;

Deno.test('initialize: protocolVersion 에코, tools capability, serverInfo', async () => {
  const { submit } = fake();
  const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, 'claude', submit) as R;
  assertEquals(r.id, 1);
  assertEquals(r.result.protocolVersion, '2025-03-26');
  assert(r.result.capabilities.tools);
  assertEquals(r.result.serverInfo, { name: 'ai-memory', version: '1.0.0' });
  const r2 = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, 'claude', submit) as R;
  assertEquals(r2.result.protocolVersion, '2025-06-18');
});

Deno.test('알림(id 없음)은 null → 202', async () => {
  const { submit } = fake();
  assertEquals(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'claude', submit), null);
});

Deno.test('tools/list: save_to_memory 1개, annotations, maxItems 3', async () => {
  const { submit } = fake();
  const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'claude', submit) as R;
  assertEquals(r.result.tools.length, 1);
  const t = r.result.tools[0];
  assertEquals(t.name, 'save_to_memory');
  assertEquals(t.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assertEquals(t.inputSchema.properties.items.maxItems, 3);
  assertEquals(t.inputSchema.properties.items.items.properties.questions.items.properties.kind.enum, ['explain', 'apply', 'compare']);
});

Deno.test('tools/call: submit 1번 호출, 텍스트에 받은함', async () => {
  const { calls, submit } = fake();
  const r = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'save_to_memory', arguments: { items: [item] } } }, 'chatgpt', submit) as R;
  assertEquals(calls.length, 1);
  assertEquals(calls[0].source, 'chatgpt');
  assert(r.result.content[0].text.includes('받은함'));
  assertEquals(r.result.isError, undefined);
});

Deno.test('tools/call: 잘못된 인자 → isError 결과, submit 안 부름', async () => {
  const { calls, submit } = fake();
  for (const args of [{}, { items: [] }, { items: [{ title: 'x' }] }, { items: [{ ...item, questions: [{ kind: 'bad', prompt: 'q' }] }] }]) {
    const r = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'save_to_memory', arguments: args } }, 'claude', submit) as R;
    assertEquals(r.result.isError, true);
    assert(r.result.content[0].text.length > 0);
    assertEquals(r.error, undefined);
  }
  assertEquals(calls.length, 0);
});

Deno.test('모르는 method → -32601, 모르는 tool → -32602, 배치 → -32600, ping → {}', async () => {
  const { submit } = fake();
  assertEquals(((await handleMcp({ jsonrpc: '2.0', id: 1, method: 'nope' }, 'claude', submit)) as R).error.code, -32601);
  assertEquals(((await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } }, 'claude', submit)) as R).error.code, -32602);
  assertEquals(((await handleMcp([{ jsonrpc: '2.0', id: 1, method: 'ping' }], 'claude', submit)) as R).error.code, -32600);
  assertEquals(((await handleMcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'claude', submit)) as R).result, {});
});

// ── HTTP 계층 (index.ts의 라우터가 그대로 쓰는 함수) ──
const post = (body: unknown, q = '') => new Request(`http://x/functions/v1/api/mcp/s3cret${q}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

Deno.test('HTTP: initialize → tools/list → tools/call 통합', async () => {
  const { calls, submit } = fake();
  const go = (req: Request, secret: string | null = 's3cret') => handleMcpRequest(req, 's3cret', secret, submit);
  const init = await go(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
  assertEquals(init.status, 200);
  assertEquals(init.headers.get('content-type'), 'application/json');
  assert(((await init.json()) as R).result.capabilities.tools);
  const note = await go(post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assertEquals(note.status, 202);
  assertEquals(await note.text(), '');
  const list = await go(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  assertEquals(((await list.json()) as R).result.tools[0].name, 'save_to_memory');
  const call = await go(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'save_to_memory', arguments: { items: [item] } } }, '?from=chatgpt'));
  assert(((await call.json()) as R).result.content[0].text.includes('받은함'));
  assertEquals(calls[0].source, 'chatgpt');
});

Deno.test('HTTP: 비밀 불일치·미설정 → 404, GET/DELETE → 405, 깨진 JSON → -32700', async () => {
  const { calls, submit } = fake();
  const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
  assertEquals((await handleMcpRequest(post(body), 'wrong', 's3cret', submit)).status, 404);
  assertEquals((await handleMcpRequest(post(body), 's3cret', null, submit)).status, 404);
  assertEquals((await handleMcpRequest(post(body), '', '', submit)).status, 404);
  for (const method of ['GET', 'DELETE']) {
    const res = await handleMcpRequest(new Request('http://x/mcp/s3cret', { method }), 's3cret', 's3cret', submit);
    assertEquals(res.status, 405);
    assertEquals(res.headers.get('allow'), 'POST');
  }
  const bad = await handleMcpRequest(new Request('http://x/mcp/s3cret', { method: 'POST', body: '{nope' }), 's3cret', 's3cret', submit);
  assertEquals(((await bad.json()) as R).error.code, -32700);
  assertEquals(calls.length, 0);
});
