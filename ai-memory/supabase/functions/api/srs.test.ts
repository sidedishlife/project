import { assertEquals } from 'jsr:@std/assert@1';
import { firstDue, INTERVALS_DAYS, MASTERED, onMerge, schedule, seoulDayEnd, type Slots } from './srs.ts';

const T = new Date('2026-11-21T03:00:00Z');
const HOUR = 3600_000;
const hours = (d: Date, from: Date) => (d.getTime() - from.getTime()) / HOUR;
const days = (d: Date, from: Date) => hours(d, from) / 24;
const st = (stage: number) => ({ stage, reviews: 0, lapses: 0 });
const slots: Slots = { morning: '07:30', evening: '19:00', bedtime: '23:00' };

Deno.test('상수', () => {
  assertEquals(INTERVALS_DAYS, [0, 1, 3, 7, 14, 30, 60, 120]);
  assertEquals(MASTERED, 7);
});
Deno.test('good: 단계 3→4, 14일 뒤', () => {
  const r = schedule(st(3), 'good', T);
  assertEquals([r.stage, days(r.due, T), r.reviews], [4, 14, 1]);
});
Deno.test('hard: 단계 유지, 간격 절반(최소 12시간)', () => {
  assertEquals(hours(schedule(st(4), 'hard', T).due, T), 7 * 24);
  assertEquals(hours(schedule(st(0), 'hard', T).due, T), 12);
  assertEquals(schedule(st(4), 'hard', T).stage, 4);
});
Deno.test('again: 두 단계 뒤로, 최소 0, lapses+1, 12시간 뒤', () => {
  const r = schedule(st(5), 'again', T);
  assertEquals([r.stage, r.lapses, hours(r.due, T)], [3, 1, 12]);
  assertEquals(schedule(st(1), 'again', T).stage, 0);
});
Deno.test('마스터 초과 금지', () => assertEquals(schedule(st(7), 'good', T).stage, 7));
Deno.test('firstDue: 서울 22:30 저장 → 다음 날 07:30', () => {
  const now = new Date('2026-11-21T13:30:00Z'); // 22:30 KST
  assertEquals(firstDue(now, slots).toISOString(), '2026-11-21T22:30:00.000Z'); // 11-22 07:30 KST
});
Deno.test('firstDue: 서울 14:00 저장 → 같은 날 23:00', () => {
  const now = new Date('2026-11-21T05:00:00Z'); // 14:00 KST
  assertEquals(firstDue(now, slots).toISOString(), '2026-11-21T14:00:00.000Z');
});
Deno.test('seoulDayEnd: UTC 15:10(서울 00:10)은 서울 그날 끝', () => {
  const now = new Date('2026-11-21T15:10:00Z'); // 11-22 00:10 KST
  assertEquals(seoulDayEnd(now).toISOString(), '2026-11-22T14:59:59.999Z');
  assertEquals(seoulDayEnd(new Date('2026-11-21T14:50:00Z')).toISOString(), '2026-11-21T14:59:59.999Z');
});
Deno.test('onMerge: 10일 뒤 due → 1일 뒤로 당김, 3시간 뒤 due는 그대로', () => {
  const far = new Date(T.getTime() + 10 * 24 * HOUR);
  assertEquals(onMerge(far, T).getTime(), T.getTime() + 24 * HOUR);
  const near = new Date(T.getTime() + 3 * HOUR);
  assertEquals(onMerge(near, T).getTime(), near.getTime());
});
