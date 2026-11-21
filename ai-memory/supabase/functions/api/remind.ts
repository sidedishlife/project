// 복습 알림 시각 판단과 발송 (순수 로직 — DB·푸시는 deps로 주입)
import type { Payload, Sub } from './push.ts';
import type { Slots } from './srs.ts';

export type SlotName = keyof Slots;
const SLOT_NAMES: SlotName[] = ['morning', 'evening', 'bedtime'];
const WINDOW_MIN = 5;
const DAY_MIN = 1440;

/** 서울 시각의 하루 중 분(0~1439). 서울은 UTC+9 고정(DST 없음). */
function seoulMinuteOfDay(now: Date): number {
  return Math.floor(now.getTime() / 60_000 + 9 * 60) % DAY_MIN;
}

/** 서울 시각이 슬롯 시각 이상, 슬롯+5분 미만이면 그 슬롯 이름, 아니면 null. 자정을 넘는 창도 처리. */
export function shouldRemind(now: Date, slots: Slots): SlotName | null {
  const cur = seoulMinuteOfDay(now);
  for (const name of SLOT_NAMES) {
    const [hh, mm] = slots[name].split(':').map(Number);
    const diff = (cur - (hh * 60 + mm) + DAY_MIN) % DAY_MIN;
    if (diff < WINDOW_MIN) return name;
  }
  return null;
}

export interface RemindDeps {
  slots: Slots;
  count: () => Promise<number>;
  subs: () => Promise<Sub[]>;
  send: (sub: Sub, payload: Payload) => Promise<'ok' | 'gone' | string>;
  remove: (endpoint: string) => Promise<void>;
}
export type RemindResult = { slot: SlotName | null; count: number; sent: number; removed: number; failed: number };

export async function remind(now: Date, d: RemindDeps): Promise<RemindResult> {
  const r: RemindResult = { slot: shouldRemind(now, d.slots), count: 0, sent: 0, removed: 0, failed: 0 };
  if (!r.slot) return r;
  r.count = await d.count();
  if (r.count < 1) return r;
  const payload: Payload = { title: 'AI 기억장', body: `오늘 복습 ${r.count}개`, url: '/' };
  for (const sub of await d.subs()) {
    const res = await d.send(sub, payload);
    if (res === 'ok') r.sent++;
    else if (res === 'gone') { await d.remove(sub.endpoint); r.removed++; }
    else r.failed++;
  }
  return r;
}
