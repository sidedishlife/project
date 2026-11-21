import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { memoryRepo, type MemoryRepo } from './repo.ts';
import { reveal, submitGrade, todayCount, todayQueue, todayResponse, type ReviewDeps } from './review.ts';
import { HttpError } from './http.ts';

// 2026-11-21 12:00 서울
const NOW = new Date('2026-11-21T03:00:00Z');
const END_OF_DAY = '2026-11-21T14:59:59.000Z'; // 서울 23:59:59
const NEXT_DAY = '2026-11-21T15:00:00.000Z'; // 서울 11-22 00:00

function setup(goal = 5, grade: ReviewDeps['ai']['gradeAnswer'] = async () => null) {
  const repo = memoryRepo();
  const deps: ReviewDeps = { repo, ai: { gradeAnswer: grade }, now: () => NOW, config: { daily_goal: goal } };
  return { repo, deps };
}
async function addConcept(repo: MemoryRepo, title: string, due: string, stage = 2, qs: string[] = []) {
  const c = await repo.insertConcept({ field_id: null, title, note_md: `노트:${title}`, stage, due_at: due });
  await repo.insertQuestions(c.id, qs.map((p) => ({ kind: 'explain' as const, prompt: p })));
  return c;
}

Deno.test('goal 5, due 7개 → 5개만, remaining_after 2', async () => {
  const { repo, deps } = setup(5);
  for (let i = 0; i < 7; i++) await addConcept(repo, `c${i}`, `2026-11-20T0${i}:00:00Z`);
  const r = await todayResponse(NOW, deps);
  assertEquals(r.items.length, 5);
  assertEquals(r.remaining_after, 2);
  assertEquals(r.items.map((i) => i.title), ['c0', 'c1', 'c2', 'c3', 'c4']);
});

Deno.test('내일 due는 제외, 서울 23:59 due는 포함', async () => {
  const { repo, deps } = setup();
  await addConcept(repo, '자정직전', END_OF_DAY);
  await addConcept(repo, '내일', NEXT_DAY);
  assertEquals((await todayQueue(NOW, deps)).map((i) => i.title), ['자정직전']);
  assertEquals(await todayCount(NOW, deps), 1);
  assertEquals((await todayResponse(NOW, deps)).tomorrow, 1);
});

Deno.test('23:50 서울과 00:10 서울의 "오늘"이 갈린다', async () => {
  const { repo, deps } = setup();
  await addConcept(repo, 'x', '2026-11-22T00:00:00Z'); // 서울 11-22 09:00
  assertEquals((await todayQueue(new Date('2026-11-21T14:50:00Z'), deps)).length, 0); // 서울 23:50
  assertEquals((await todayQueue(new Date('2026-11-21T15:10:00Z'), deps)).length, 1); // 서울 11-22 00:10
});

Deno.test('응답에 note_md가 없다', async () => {
  const { repo, deps } = setup();
  await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 1, ['Q']);
  const c2 = await addConcept(repo, 'b', '2026-11-20T01:00:00Z');
  const [i1, i2] = await todayQueue(NOW, deps);
  assert(!('note_md' in i1) && !JSON.stringify(i1).includes('노트:'));
  assertEquals(i2.question, '「b」을(를) 설명해 보세요.');
  assertEquals(i2.question_id, null);
  assertEquals(i2.unit_id, c2.id);
});

Deno.test('질문 선택: last_asked_at null 먼저, 그다음 오래된 순, 동률은 id', async () => {
  const { repo, deps } = setup();
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 1, ['q1', 'q2', 'q3']);
  repo.data.questions[0].last_asked_at = '2026-11-01T00:00:00Z';
  repo.data.questions[1].last_asked_at = '2026-11-10T00:00:00Z';
  repo.data.questions[2].last_asked_at = null;
  assertEquals((await todayQueue(NOW, deps))[0].question, 'q3');
  repo.data.questions[2].last_asked_at = '2026-11-15T00:00:00Z';
  assertEquals((await todayQueue(NOW, deps))[0].question, 'q1');
  for (const q of repo.data.questions) q.last_asked_at = null;
  const first = [...repo.data.questions].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  assertEquals((await todayQueue(NOW, deps))[0].question_id, first.id);
  assertEquals(c.id, (await todayQueue(NOW, deps))[0].unit_id);
});

Deno.test('개념과 짝이 due 순으로 섞이고 짝은 제목 vs 제목', async () => {
  const { repo, deps } = setup();
  const a = await addConcept(repo, 'A', '2026-11-20T05:00:00Z');
  const b = await addConcept(repo, 'B', '2026-11-20T07:00:00Z');
  const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
  await repo.insertPair({ concept_a: lo.id, concept_b: hi.id, question: '차이는?', stage: 0, due_at: '2026-11-20T06:00:00Z' });
  const q = await todayQueue(NOW, deps);
  assertEquals(q.map((i) => i.unit_type), ['concept', 'pair', 'concept']);
  assertEquals(q[1].title, `「${lo.title}」 vs 「${hi.title}」`);
  assertEquals(q[1].question, '차이는?');
  const rv = await reveal(deps, 'pair', q[1].unit_id);
  assertEquals(rv.note_md, `## ${lo.title}\n\n노트:${lo.title}\n\n---\n\n## ${hi.title}\n\n노트:${hi.title}`);
});

Deno.test('reveal: 개념 노트, 없으면 404', async () => {
  const { repo, deps } = setup();
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z');
  assertEquals(await reveal(deps, 'concept', c.id), { note_md: '노트:a' });
  const e = await assertRejects(() => reveal(deps, 'concept', 'nope'), HttpError);
  assertEquals(e.status, 404);
});

Deno.test('quick good → stage+1, reviews+1, review_log 1행, last_asked_at 갱신', async () => {
  const { repo, deps } = setup();
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 2, ['q']);
  const qid = repo.data.questions[0].id;
  const r = await submitGrade(deps, { unit_type: 'concept', unit_id: c.id, mode: 'quick', grade: 'good', question_id: qid });
  assertEquals(r.grade, 'good');
  assertEquals(r.next_due, new Date(NOW.getTime() + 7 * 86400_000).toISOString());
  const row = repo.data.concepts[0];
  assertEquals([row.stage, row.reviews, row.lapses, row.due_at], [3, 1, 0, r.next_due]);
  assertEquals(repo.data.reviewLog.length, 1);
  assertEquals(repo.data.reviewLog[0].mode, 'quick');
  assertEquals(repo.data.questions[0].last_asked_at, NOW.toISOString());
});

Deno.test('quick again → 2단계 뒤로, lapses+1 (한 번만 증가)', async () => {
  const { repo, deps } = setup();
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 4);
  await submitGrade(deps, { unit_type: 'concept', unit_id: c.id, mode: 'quick', grade: 'again' });
  assertEquals([repo.data.concepts[0].stage, repo.data.concepts[0].lapses, repo.data.concepts[0].reviews], [2, 1, 1]);
});

Deno.test('deep 채점 null → grade null, 일정·로그 그대로', async () => {
  const { repo, deps } = setup(5, async () => null);
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 3, ['q']);
  const r = await submitGrade(deps, { unit_type: 'concept', unit_id: c.id, mode: 'deep', answer: '내 답' });
  assertEquals(r, { grade: null, feedback: null, next_due: null });
  assertEquals([repo.data.concepts[0].stage, repo.data.concepts[0].reviews, repo.data.concepts[0].due_at], [3, 0, '2026-11-20T00:00:00Z']);
  assertEquals(repo.data.reviewLog.length, 0);
  assertEquals(repo.data.questions[0].last_asked_at, null);
});

Deno.test('deep 채점 성공 → AI 등급 적용, feedback 저장, 질문·노트 전달', async () => {
  let seen: string[] = [];
  const { repo, deps } = setup(5, async (q, n, a) => {
    seen = [q, n, a];
    return { grade: 'hard' as const, hit: ['x'], missed: ['y'], comment: '굿' };
  });
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 3, ['설명하라']);
  const r = await submitGrade(deps, { unit_type: 'concept', unit_id: c.id, mode: 'deep', answer: '내 답', question_id: repo.data.questions[0].id });
  assertEquals(seen, ['설명하라', '노트:a', '내 답']);
  assertEquals(r.grade, 'hard');
  assertEquals(r.feedback, { hit: ['x'], missed: ['y'], comment: '굿' });
  assertEquals(repo.data.concepts[0].stage, 3);
  assertEquals(repo.data.reviewLog[0].feedback, { hit: ['x'], missed: ['y'], comment: '굿' });
  assertEquals(repo.data.reviewLog[0].answer, '내 답');
});

Deno.test('짝 채점도 짝의 일정을 갱신', async () => {
  const { repo, deps } = setup();
  const a = await addConcept(repo, 'A', '2030-01-01T00:00:00Z');
  const b = await addConcept(repo, 'B', '2030-01-01T00:00:00Z');
  const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
  await repo.insertPair({ concept_a: lo.id, concept_b: hi.id, question: 'Q', stage: 0, due_at: '2026-11-20T00:00:00Z' });
  const p = repo.data.pairs[0];
  await submitGrade(deps, { unit_type: 'pair', unit_id: p.id, mode: 'quick', grade: 'good' });
  assertEquals([repo.data.pairs[0].stage, repo.data.pairs[0].reviews], [1, 1]);
  assertEquals(repo.data.concepts.every((c) => c.stage === 2), true);
});

Deno.test('오류: 없는 대상 404, quick에 grade 없음/잘못된 grade 400, deep에 답 없음 400', async () => {
  const { repo, deps } = setup();
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z');
  const st = async (i: Parameters<typeof submitGrade>[1]) => (await assertRejects(() => submitGrade(deps, i), HttpError)).status;
  assertEquals(await st({ unit_type: 'concept', unit_id: 'nope', mode: 'quick', grade: 'good' }), 404);
  assertEquals(await st({ unit_type: 'concept', unit_id: c.id, mode: 'quick' }), 400);
  // deno-lint-ignore no-explicit-any
  assertEquals(await st({ unit_type: 'concept', unit_id: c.id, mode: 'quick', grade: 'bad' as any }), 400);
  assertEquals(await st({ unit_type: 'concept', unit_id: c.id, mode: 'deep', answer: '  ' }), 400);
  assertEquals(repo.data.reviewLog.length, 0);
});

Deno.test('deep + grade(자기채점 재전송) → AI 호출 없이 그 grade 적용, feedback null, 답 기록', async () => {
  const { repo, deps } = setup(5, () => { throw new Error('AI must not be called'); });
  const c = await addConcept(repo, 'a', '2026-11-20T00:00:00Z', 3, ['q']);
  const r = await submitGrade(deps, { unit_type: 'concept', unit_id: c.id, mode: 'deep', answer: '내 답', grade: 'good', question_id: repo.data.questions[0].id });
  assertEquals([r.grade, r.feedback], ['good', null]);
  assertEquals(repo.data.concepts[0].stage, 4);
  assertEquals(repo.data.reviewLog.length, 1);
  assertEquals([repo.data.reviewLog[0].mode, repo.data.reviewLog[0].answer, repo.data.reviewLog[0].feedback], ['deep', '내 답', null]);
  assertEquals(repo.data.questions[0].last_asked_at, NOW.toISOString());
});

Deno.test('daily_goal이 NaN이면 5로', async () => {
  const { repo, deps } = setup(NaN);
  for (let i = 0; i < 7; i++) await addConcept(repo, `c${i}`, `2026-11-20T0${i}:00:00Z`);
  assertEquals((await todayResponse(NOW, deps)).items.length, 5);
});
