import { assertEquals } from 'jsr:@std/assert@1';
import { remind, shouldRemind } from './remind.ts';
import type { Sub } from './push.ts';
import { memoryRepo } from './repo.ts';
import { todayAvailable } from './review.ts';

const SLOTS = { morning: '07:30', evening: '18:30', bedtime: '23:00' };
// 서울 시각 → UTC (서울 = UTC+9)
const seoul = (hhmm: string) => new Date(`2026-11-21T${hhmm}:00+09:00`);

Deno.test('shouldRemind: 슬롯 시각부터 5분 미만만 해당', () => {
  assertEquals(shouldRemind(seoul('07:32'), SLOTS), 'morning');
  assertEquals(shouldRemind(seoul('07:30'), SLOTS), 'morning');
  assertEquals(shouldRemind(seoul('07:35'), SLOTS), null);
  assertEquals(shouldRemind(seoul('07:40'), SLOTS), null);
  assertEquals(shouldRemind(seoul('07:29'), SLOTS), null);
  assertEquals(shouldRemind(seoul('18:34'), SLOTS), 'evening');
  assertEquals(shouldRemind(seoul('23:01'), SLOTS), 'bedtime');
});

Deno.test('shouldRemind: 자정을 넘기는 창(23:58 슬롯, 00:02)', () => {
  const slots = { ...SLOTS, bedtime: '23:58' };
  assertEquals(shouldRemind(seoul('00:02'), slots), 'bedtime');
  assertEquals(shouldRemind(seoul('00:03'), slots), null);
});

const sub = (n: string): Sub => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });
function mk(count: number, results: Record<string, 'ok' | 'gone' | string>) {
  const sent: { sub: Sub; payload: unknown }[] = [];
  const removed: string[] = [];
  return {
    sent, removed,
    deps: {
      slots: SLOTS,
      count: async () => count,
      subs: async () => Object.keys(results).map(sub),
      send: async (s: Sub, payload: unknown) => { sent.push({ sub: s, payload }); return results[s.endpoint.split('/').pop()!]; },
      remove: async (endpoint: string) => { removed.push(endpoint); },
    },
  };
}

Deno.test('remind: 슬롯 밖이면 아무것도 안 보냄', async () => {
  const t = mk(3, { a: 'ok' });
  assertEquals(await remind(seoul('12:00'), t.deps), { slot: null, count: 0, sent: 0, removed: 0, failed: 0 });
  assertEquals(t.sent.length, 0);
});

Deno.test('remind: 큐가 0이면 보내지 않음', async () => {
  const t = mk(0, { a: 'ok' });
  assertEquals(await remind(seoul('07:31'), t.deps), { slot: 'morning', count: 0, sent: 0, removed: 0, failed: 0 });
  assertEquals(t.sent.length, 0);
});

Deno.test('remind: 오늘 복습 N개 발송, gone은 삭제, 그 외 실패는 집계', async () => {
  const t = mk(4, { a: 'ok', b: 'gone', c: '500 boom' });
  assertEquals(await remind(seoul('18:31'), t.deps), { slot: 'evening', count: 4, sent: 1, removed: 1, failed: 1 });
  assertEquals(t.removed, ['https://push.example/b']);
  assertEquals(t.sent[0].payload, { title: 'AI 기억장', body: '오늘 복습 4개', url: '/' });
});

Deno.test('remind: 알림 개수는 화면과 같이 min(오늘 due, 남은 칸), 0이면 발송 안 함', async () => {
  const repo = memoryRepo();
  for (let i = 0; i < 8; i++) await repo.insertConcept({ field_id: null, title: `c${i}`, note_md: 'n', stage: 2, due_at: `2026-11-20T0${i}:00:00Z` });
  const now = seoul('07:31');
  const rd = { repo, ai: { gradeAnswer: async () => null }, now: () => now, config: { daily_goal: 5 } };
  const run = async () => {
    const t = mk(0, { a: 'ok' });
    const res = await remind(now, { ...t.deps, count: () => todayAvailable(now, rd) });
    return { res, t };
  };
  let { res, t } = await run();
  assertEquals(res.count, 5); // 8개 due지만 목표 5
  assertEquals((t.sent[0].payload as { body: string }).body, '오늘 복습 5개');
  for (let i = 0; i < 3; i++) await repo.insertReviewLog({ unit_type: 'concept', unit_id: `r${i}`, grade: 'good', mode: 'quick', answer: null, feedback: null, at: '2026-11-21T00:00:00Z' });
  ({ res, t } = await run());
  assertEquals(res.count, 2);
  for (let i = 3; i < 5; i++) await repo.insertReviewLog({ unit_type: 'concept', unit_id: `r${i}`, grade: 'good', mode: 'quick', answer: null, feedback: null, at: '2026-11-21T00:00:00Z' });
  ({ res, t } = await run());
  assertEquals([res.count, res.sent, t.sent.length], [0, 0, 0]);
});
