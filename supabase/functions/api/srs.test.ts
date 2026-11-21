import { assertEquals } from 'jsr:@std/assert@1';
import { schedule, INTERVALS, MASTERED_STAGE, listensThisReview, LISTEN_TARGET, FIRST_LISTENS } from './srs.ts';

const base = { stage: 0, reviews: 0, lapses: 0 };

Deno.test('알았음: 단계와 간격이 늘어남', () => {
  const r = schedule(base, 'good', 0);
  assertEquals(r.stage, 1);
  assertEquals(r.due, INTERVALS[1]);
});
Deno.test('몰랐음: 처음 단계로, 잊은 횟수 +1, 10분 뒤', () => {
  const r = schedule({ ...base, stage: 4 }, 'again', 0);
  assertEquals([r.stage, r.lapses, r.due], [0, 1, INTERVALS[0]]);
});
Deno.test('헷갈림: 단계 유지, 간격 절반', () => {
  const r = schedule({ ...base, stage: 3 }, 'hard', 0);
  assertEquals([r.stage, r.due], [3, INTERVALS[3] / 2]);
});
Deno.test('마스터 단계는 넘지 않음', () => {
  assertEquals(schedule({ ...base, stage: MASTERED_STAGE }, 'good', 0).stage, MASTERED_STAGE);
});
Deno.test('복습할 때마다 알았음을 누르면 누적 20회를 채움', () => {
  let listens = FIRST_LISTENS, stage = 0;
  const plan: number[] = [];
  while (stage < MASTERED_STAGE) {
    const n = listensThisReview(listens, stage);
    plan.push(n);
    listens += n;
    stage = schedule({ stage, reviews: 0, lapses: 0 }, 'good', 0).stage;
  }
  console.log('처음', FIRST_LISTENS, '회 + 복습별', plan.join(', '), '→ 누적', listens);
  assertEquals(listens >= LISTEN_TARGET, true);
});
