export type Grade = 'good' | 'hard' | 'again';
export const INTERVALS_DAYS = [0, 1, 3, 7, 14, 30, 60, 120];
export const MASTERED = 7;
export interface SrsState { stage: number; reviews: number; lapses: number }
export type Slots = { morning: string; evening: string; bedtime: string };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const TZ = 'Asia/Seoul';

export function schedule(s: SrsState, g: Grade, now: Date): SrsState & { due: Date } {
  const t = now.getTime();
  const reviews = s.reviews + 1;
  if (g === 'good') {
    const stage = Math.min(MASTERED, s.stage + 1);
    return { stage, reviews, lapses: s.lapses, due: new Date(t + INTERVALS_DAYS[stage] * DAY) };
  }
  if (g === 'hard') {
    const ms = Math.max(12 * HOUR, (INTERVALS_DAYS[s.stage] / 2) * DAY);
    return { stage: s.stage, reviews, lapses: s.lapses, due: new Date(t + ms) };
  }
  return { stage: Math.max(0, s.stage - 2), reviews, lapses: s.lapses + 1, due: new Date(t + 12 * HOUR) };
}

const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function seoulParts(d: Date): { y: number; m: number; d: number } {
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day };
}

/** Seoul wall-clock time -> UTC instant (Seoul has no DST; offset derived via Intl). */
function seoulToDate(y: number, m: number, d: number, hh: number, mm: number, ss = 0, ms = 0): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(guess))) p[x.type] = x.value;
  const asSeoul = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second, ms);
  return new Date(guess - (asSeoul - guess));
}

export function seoulDayStart(now: Date): Date {
  const { y, m, d } = seoulParts(now);
  return seoulToDate(y, m, d, 0, 0, 0, 0);
}

export function seoulDayEnd(now: Date): Date {
  const { y, m, d } = seoulParts(now);
  return seoulToDate(y, m, d, 23, 59, 59, 999);
}

export function firstDue(now: Date, slots: Slots): Date {
  const earliest = now.getTime() + HOUR;
  const base = seoulParts(now);
  let best: Date | null = null;
  for (const hhmm of [slots.bedtime, slots.morning]) {
    const [hh, mm] = hhmm.split(':').map(Number);
    for (let add = 0; add <= 2; add++) {
      const day = new Date(Date.UTC(base.y, base.m - 1, base.d + add));
      const c = seoulToDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
      if (c.getTime() >= earliest) {
        if (!best || c < best) best = c;
        break;
      }
    }
  }
  return best!;
}

export function onMerge(due: Date, now: Date): Date {
  const cap = new Date(now.getTime() + DAY);
  return due < cap ? due : cap;
}
