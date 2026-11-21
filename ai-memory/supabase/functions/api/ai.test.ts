import { assertEquals } from 'jsr:@std/assert@1';
import { compareQuestion, extractCandidates, gradeAnswer, matchConcept, mergeNote } from './ai.ts';

// deno-lint-ignore no-explicit-any
type Params = any;
const reply = (obj: unknown, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text: JSON.stringify(obj) }] });
const fake = (r: unknown, calls: Params[] = []) => ({ messages: { create: (p: Params) => { calls.push(p); return Promise.resolve(r); } } });
const fakeStop = (stop: string) => fake({ stop_reason: stop, content: [{ type: 'text', text: '{"a":1}' }] });
const fakeThrow = () => ({ messages: { create: () => Promise.reject(new Error('boom')) } });
const opts = (client: unknown) => ({ client, model: 'test-model' }) as Params;

Deno.test('정상 JSON → 객체', async () => {
  const r = await gradeAnswer('q', 'n', 'a', opts(fake(reply({ grade: 'good', hit: ['x'], missed: [], comment: 'ok' }))));
  assertEquals(r?.grade, 'good');
});
Deno.test('refusal → null', async () => assertEquals(await gradeAnswer('q', 'n', 'a', opts(fakeStop('refusal'))), null));
Deno.test('max_tokens → null', async () => assertEquals(await gradeAnswer('q', 'n', 'a', opts(fakeStop('max_tokens'))), null));
Deno.test('API 오류 → null', async () => assertEquals(await mergeNote('a', 'b', opts(fakeThrow())), null));
Deno.test('JSON 파싱 실패 → null', async () => {
  const c = fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] });
  assertEquals(await mergeNote('a', 'b', opts(c)), null);
});
Deno.test('text 블록 없음 → null', async () => {
  assertEquals(await mergeNote('a', 'b', opts(fake({ stop_reason: 'end_turn', content: [] }))), null);
});
Deno.test('잘못된 grade → null', async () => {
  assertEquals(await gradeAnswer('q', 'n', 'a', opts(fake(reply({ grade: 'great', hit: [], missed: [], comment: '' })))), null);
});
Deno.test('요청 형태: 모델·effort·json_schema·max_tokens', async () => {
  const calls: Params[] = [];
  await mergeNote('a', 'b', opts(fake(reply({ note_md: 'x', changes: [] }), calls)));
  const p = calls[0];
  assertEquals(p.model, 'test-model');
  assertEquals(p.max_tokens, 4000);
  assertEquals(p.output_config.effort, 'low');
  assertEquals(p.output_config.format.type, 'json_schema');
  assertEquals(p.output_config.format.schema.additionalProperties, false);
  assertEquals(p.messages[0].role, 'user');
});
Deno.test('matchConcept: 개념 목록은 캐시 system 블록, id 정렬, 후보는 user', async () => {
  const calls: Params[] = [];
  const existing = [
    { id: 'b', title: 'B개념', summary: 'y'.repeat(300) },
    { id: 'a', title: 'A개념', summary: 'x' },
  ];
  const r = await matchConcept({ title: 'T', note_md: 'N' }, existing, opts(fake(reply({ action: 'merge', target_id: 'a', reason: 'r' }), calls)));
  assertEquals(r?.target_id, 'a');
  const sys = calls[0].system;
  const last = sys[sys.length - 1];
  assertEquals(last.cache_control, { type: 'ephemeral' });
  assertEquals(last.text.indexOf('id=a') < last.text.indexOf('id=b'), true);
  assertEquals(last.text.includes('y'.repeat(201)), false); // 앞 200자만
  assertEquals(calls[0].messages[0].content.includes('T'), true);
});
Deno.test('matchConcept: merge/pair인데 target 없거나 목록에 없으면 null', async () => {
  const ex = [{ id: 'a', title: 'A', summary: '' }];
  assertEquals(await matchConcept({ title: 'T', note_md: 'N' }, ex, opts(fake(reply({ action: 'merge', target_id: null, reason: '' })))), null);
  assertEquals(await matchConcept({ title: 'T', note_md: 'N' }, ex, opts(fake(reply({ action: 'pair', target_id: 'zzz', reason: '' })))), null);
  assertEquals((await matchConcept({ title: 'T', note_md: 'N' }, ex, opts(fake(reply({ action: 'new', target_id: null, reason: 'x' })))))?.action, 'new');
});
Deno.test('compareQuestion → 문자열', async () => {
  const r = await compareQuestion({ title: 'a', note_md: 'x' }, { title: 'b', note_md: 'y' }, opts(fake(reply({ question: 'P&ID와 PFD의 차이는?' }))));
  assertEquals(r, 'P&ID와 PFD의 차이는?');
});
Deno.test('extractCandidates: 최대 3개로 자름', async () => {
  const c = { title: 't', note_md: 'n', questions: [{ kind: 'explain', prompt: 'p' }] };
  const r = await extractCandidates('대화', opts(fake(reply({ candidates: [c, c, c, c, c] }))));
  assertEquals(r?.length, 3);
});
