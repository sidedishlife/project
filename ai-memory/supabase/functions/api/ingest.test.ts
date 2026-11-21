import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { memoryRepo } from './repo.ts';
import { confirmCandidate, pasteConversation, submitCandidates, type IngestDeps } from './ingest.ts';
import { HttpError } from './http.ts';
import type { CandidateInput } from './types.ts';

const NOW = new Date('2026-11-21T03:00:00Z');
const slots = { morning: '07:30', evening: '18:30', bedtime: '23:00' };
const cand = (n: number, extra: Partial<CandidateInput> = {}): CandidateInput => ({
  title: `개념${n}`, note_md: `노트${n}`, questions: [{ kind: 'explain', prompt: `질문${n}` }], ...extra,
});

function setup(over: Partial<IngestDeps['ai']> = {}, mask = false, terms: { term: string; alias: string }[] = []) {
  const repo = memoryRepo({ mask: terms });
  const deps: IngestDeps = {
    repo,
    ai: {
      matchConcept: async () => null,
      mergeNote: async () => null,
      compareQuestion: async () => null,
      extractCandidates: async () => null,
      ...over,
    },
    now: () => NOW,
    config: { mask_enabled: mask, slots },
  };
  return { repo, deps };
}

Deno.test('4개 제출 → 3개 저장, 1개 over_limit', async () => {
  const { repo, deps } = setup();
  const r = await submitCandidates(deps, 'claude', [cand(1), cand(2), cand(3), cand(4)]);
  assertEquals(r, { created: 3, skipped_duplicates: 0, over_limit: 1 });
  assertEquals(repo.data.candidates.length, 3);
});

Deno.test('같은 내용 두 번 → 두 번째는 중복 무시', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'claude', [cand(1)]);
  const r = await submitCandidates(deps, 'claude', [cand(1)]);
  assertEquals(r, { created: 0, skipped_duplicates: 1, over_limit: 0 });
  assertEquals(repo.data.candidates.length, 1);
});

Deno.test('24시간이 지난 같은 내용은 다시 받는다', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'claude', [cand(1)]);
  repo.data.candidates[0].created_at = new Date(NOW.getTime() - 25 * 3600_000).toISOString();
  assertEquals((await submitCandidates(deps, 'claude', [cand(1)])).created, 1);
});

Deno.test('같은 제출 안의 중복도 무시', async () => {
  const { deps } = setup();
  assertEquals(await submitCandidates(deps, 'claude', [cand(1), cand(1)]), { created: 1, skipped_duplicates: 1, over_limit: 0 });
});

Deno.test('matchConcept null → proposal.action new', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'chatgpt', [cand(1)]);
  assertEquals(repo.data.candidates[0].proposal, { action: 'new' });
});

Deno.test('merge 제안이면 mergeNote 초안을 proposal에 저장', async () => {
  const { repo, deps } = setup();
  const c = await repo.insertConcept({ field_id: null, title: '기존', note_md: '옛 노트', stage: 2, due_at: NOW.toISOString() });
  deps.ai.matchConcept = async (_c, existing) => {
    assertEquals(existing, [{ id: c.id, title: '기존', summary: '옛 노트' }]);
    return { action: 'merge', target_id: c.id, reason: '같은 개념' };
  };
  deps.ai.mergeNote = async (o, a) => ({ note_md: `${o}+${a}`, changes: ['합침'] });
  await submitCandidates(deps, 'claude', [cand(1)]);
  const p = repo.data.candidates[0].proposal!;
  assertEquals([p.action, p.target_id, p.merged_note_md, p.changes], ['merge', c.id, '옛 노트+노트1', ['합침']]);
});

Deno.test('mask_enabled면 저장 전에 가리고, 해시는 가린 내용 기준', async () => {
  const { repo, deps } = setup({}, true, [{ term: 'A사', alias: '발주처1' }]);
  await submitCandidates(deps, 'claude', [{ title: 'A사 계약', note_md: 'A사 메모', questions: [{ kind: 'apply', prompt: 'A사는?' }] }]);
  const c = repo.data.candidates[0];
  assertEquals([c.title, c.note_md, c.questions[0].prompt], ['발주처1 계약', '발주처1 메모', '발주처1는?']);
  // 이미 가려진 내용으로 다시 와도 같은 해시
  assertEquals((await submitCandidates(deps, 'claude', [{ title: '발주처1 계약', note_md: '발주처1 메모', questions: [] }])).skipped_duplicates, 1);
});

Deno.test('merge 확정 → 버전 1행, 노트 교체, 질문 추가, due 1일 이내', async () => {
  const { repo, deps } = setup();
  const c = await repo.insertConcept({ field_id: null, title: '기존', note_md: '옛 노트', stage: 4, due_at: new Date(NOW.getTime() + 14 * 86400_000).toISOString() });
  deps.ai.matchConcept = async () => ({ action: 'merge', target_id: c.id, reason: '' });
  deps.ai.mergeNote = async () => ({ note_md: '합친 노트', changes: [] });
  await submitCandidates(deps, 'claude', [cand(1)]);
  const id = repo.data.candidates[0].id;
  await confirmCandidate(deps, id, { action: 'merge' });
  assertEquals(repo.data.versions.length, 1);
  assertEquals(repo.data.versions[0].note_md, '옛 노트');
  const after = repo.data.concepts[0];
  assertEquals(after.note_md, '합친 노트');
  assertEquals(after.updated_at, NOW.toISOString());
  assert(new Date(after.due_at!).getTime() - NOW.getTime() <= 86400_000);
  assertEquals(repo.data.questions.map((q) => q.prompt), ['질문1']);
  assertEquals(repo.data.candidates[0].status, 'done');
});

Deno.test('merge 확정: 초안 없으면 그 자리에서 mergeNote, 실패하면 --- 로 덧붙임', async () => {
  const { repo, deps } = setup();
  const c = await repo.insertConcept({ field_id: null, title: '기존', note_md: '옛 노트', stage: 1, due_at: NOW.toISOString() });
  await submitCandidates(deps, 'claude', [cand(1)]); // proposal = new
  await confirmCandidate(deps, repo.data.candidates[0].id, { action: 'merge', target_id: c.id });
  assertEquals(repo.data.concepts[0].note_md, '옛 노트\n\n---\n\n노트1');
});

Deno.test('merge 확정: target_id 없으면 400, 없는 후보 404, 이미 처리된 후보 409', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'claude', [cand(1)]);
  const id = repo.data.candidates[0].id;
  const st = async (p: Promise<unknown>) => (await assertRejects(() => p, HttpError) as HttpError).status;
  assertEquals(await st(confirmCandidate(deps, id, { action: 'merge' })), 400);
  assertEquals(await st(confirmCandidate(deps, crypto.randomUUID(), { action: 'discard' })), 404);
  await confirmCandidate(deps, id, { action: 'discard' });
  assertEquals(await st(confirmCandidate(deps, id, { action: 'discard' })), 409);
});

Deno.test('discard → concepts 변화 없음, status만 변경', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'claude', [cand(1)]);
  await confirmCandidate(deps, repo.data.candidates[0].id, { action: 'discard' });
  assertEquals(repo.data.concepts.length, 0);
  assertEquals(repo.data.candidates[0].status, 'discarded');
});

Deno.test('new 확정: stage 0, due=firstDue, 질문 생성, field_id 사용', async () => {
  const { repo, deps } = setup();
  const f = await repo.insertField('공정');
  await submitCandidates(deps, 'claude', [cand(1)]);
  await confirmCandidate(deps, repo.data.candidates[0].id, { action: 'new', field_id: f.id });
  const c = repo.data.concepts[0];
  assertEquals([c.stage, c.field_id, c.title], [0, f.id, '개념1']);
  assert(new Date(c.due_at!).getTime() >= NOW.getTime() + 3600_000);
  assertEquals(repo.data.questions.length, 1);
});

Deno.test('new 확정: field_id 없으면 field_hint 분야 찾기/만들기, 없으면 미분류', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'claude', [cand(1, { field_hint: '배관' }), cand(2, { field_hint: '배관' }), cand(3)]);
  for (const c of [...repo.data.candidates]) await confirmCandidate(deps, c.id, { action: 'new' });
  assertEquals(repo.data.fields.map((f) => f.name).sort(), ['미분류', '배관']);
  assertEquals(repo.data.concepts[0].field_id, repo.data.concepts[1].field_id);
});

Deno.test('pair 확정: 순서 a<b, compareQuestion 사용, 실패 시 대체 문장', async () => {
  const { repo, deps } = setup();
  const other = await repo.insertConcept({ field_id: null, title: 'PFD', note_md: 'x', stage: 1, due_at: NOW.toISOString() });
  await submitCandidates(deps, 'claude', [cand(1, { title: 'P&ID' })]);
  const id = repo.data.candidates[0].id;
  await confirmCandidate(deps, id, { action: 'pair', target_id: other.id });
  const created = repo.data.concepts.find((c) => c.id !== other.id)!;
  const p = repo.data.pairs[0];
  assertEquals([p.concept_a, p.concept_b], [created.id, other.id].sort());
  assertEquals(p.stage, 0);
  assert(p.question.includes('P&ID') && p.question.includes('PFD'));
  assert(p.question.startsWith('「'));
});

Deno.test('pair 확정: compareQuestion 결과 사용', async () => {
  const { repo, deps } = setup({ compareQuestion: async () => 'AI 질문' });
  const other = await repo.insertConcept({ field_id: null, title: 'B', note_md: 'x', stage: 1, due_at: NOW.toISOString() });
  await submitCandidates(deps, 'claude', [cand(1)]);
  await confirmCandidate(deps, repo.data.candidates[0].id, { action: 'pair', target_id: other.id });
  assertEquals(repo.data.pairs[0].question, 'AI 질문');
});

Deno.test('pasteConversation: 추출 결과를 paste로 제출, 실패하면 502', async () => {
  const { repo, deps } = setup({ extractCandidates: async () => [cand(1), cand(2)] });
  assertEquals(await pasteConversation(deps, '대화'), { created: 2 });
  assertEquals(repo.data.candidates[0].source, 'paste');
  deps.ai.extractCandidates = async () => null;
  assertEquals((await assertRejects(() => pasteConversation(deps, '대화'), HttpError) as HttpError).status, 502);
  deps.ai.extractCandidates = async () => [];
  assertEquals(await pasteConversation(deps, '대화'), { created: 0 });
});

Deno.test('같은 개념으로 합치는 후보 둘 → 둘 다 확정해도 두 내용이 모두 남는다', async () => {
  const { repo, deps } = setup();
  const x = await repo.insertConcept({ field_id: null, title: 'X', note_md: 'base', stage: 2, due_at: NOW.toISOString() });
  deps.ai.matchConcept = async () => ({ action: 'merge', target_id: x.id, reason: '' });
  // 가짜 AI: 기존 + 추가를 이어 붙임
  deps.ai.mergeNote = async (o, a) => ({ note_md: `${o}|${a}`, changes: [] });
  await submitCandidates(deps, 'claude', [cand(1), cand(2)]);
  const [c1, c2] = repo.data.candidates.map((c) => c.id);
  await confirmCandidate(deps, c1, { action: 'merge' });
  await confirmCandidate(deps, c2, { action: 'merge' }); // 초안은 'base' 기준이라 낡음 → 다시 합쳐야 함
  const note = repo.data.concepts[0].note_md;
  assert(note.includes('노트1') && note.includes('노트2'), note);
  assertEquals(repo.data.versions.length, 2);
});

Deno.test('중복 확인 뒤 삽입 사이에 같은 해시가 들어오면 조건부 삽입이 막는다', async () => {
  const { repo, deps } = setup();
  const orig = deps.ai.matchConcept;
  let injected = false;
  deps.ai.matchConcept = async (...a) => {
    if (!injected) { injected = true; await repo.insertCandidateIfNew({ source: 'claude', content_hash: await h('개념1\n노트1'), title: '개념1', note_md: '노트1', questions: [], field_hint: null, proposal: null, created_at: NOW.toISOString() }, new Date(0)); }
    return orig(...a);
  };
  await repo.insertConcept({ field_id: null, title: '기존', note_md: 'x', stage: 0, due_at: NOW.toISOString() });
  assertEquals(await submitCandidates(deps, 'claude', [cand(1)]), { created: 0, skipped_duplicates: 1, over_limit: 0 });
  assertEquals(repo.data.candidates.length, 1);
});

async function h(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.test('개념이 하나도 없으면 matchConcept를 부르지 않는다', async () => {
  let called = 0;
  const { deps } = setup({ matchConcept: async () => { called++; return null; } });
  await submitCandidates(deps, 'claude', [cand(1)]);
  assertEquals(called, 0);
});

Deno.test('확정 중 실패하면 후보는 pending으로 돌아간다', async () => {
  const { repo, deps } = setup();
  await submitCandidates(deps, 'claude', [cand(1)]);
  const id = repo.data.candidates[0].id;
  await assertRejects(() => confirmCandidate(deps, id, { action: 'merge' }), HttpError); // target 없음 → 400
  assertEquals(repo.data.candidates[0].status, 'pending');
});
