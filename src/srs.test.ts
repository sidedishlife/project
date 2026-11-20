import { describe, it, expect } from 'vitest';
import { schedule, INTERVALS, MASTERED_STAGE, newCardSchedule } from './srs';
import type { Card } from './types';

const base = (): Card => ({ id: 'x', ko: '', en: '', alts: [], note: '', words: [], createdAt: 0, ...newCardSchedule(0) });

describe('schedule', () => {
  it('good advances stage and interval', () => {
    const c = schedule(base(), 'good', 0);
    expect(c.stage).toBe(1);
    expect(c.due).toBe(INTERVALS[1]);
  });
  it('again resets to stage 0 and counts a lapse', () => {
    const c = schedule({ ...base(), stage: 4 }, 'again', 0);
    expect(c.stage).toBe(0);
    expect(c.lapses).toBe(1);
    expect(c.due).toBe(INTERVALS[0]);
  });
  it('hard keeps stage', () => {
    const c = schedule({ ...base(), stage: 3 }, 'hard', 0);
    expect(c.stage).toBe(3);
    expect(c.due).toBe(INTERVALS[3] / 2);
  });
  it('caps at mastered', () => {
    const c = schedule({ ...base(), stage: MASTERED_STAGE }, 'good', 0);
    expect(c.stage).toBe(MASTERED_STAGE);
  });
});
