import { describe, it, expect } from 'vitest';
import { mergeCards, mergeStats } from './sync';
import type { Card } from './types';

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id, ko: id, en: id, alts: [], note: '', words: [], createdAt: 1, stage: 0, due: 0, listens: 0, reviews: 0, lapses: 0, ...extra,
});

describe('mergeCards', () => {
  it('keeps cards that exist on only one side', () => {
    const { merged, toUpload } = mergeCards([card('a')], [card('b')]);
    expect(merged.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(toUpload.map((c) => c.id)).toEqual(['a']);
  });
  it('picks the more recently updated copy', () => {
    const { merged, toUpload } = mergeCards([card('a', { stage: 3, updatedAt: 50 })], [card('a', { stage: 1, updatedAt: 20 })]);
    expect(merged[0].stage).toBe(3);
    expect(toUpload).toHaveLength(1);
    const r = mergeCards([card('a', { stage: 1, updatedAt: 20 })], [card('a', { stage: 3, updatedAt: 50 })]);
    expect(r.merged[0].stage).toBe(3);
    expect(r.toUpload).toHaveLength(0);
  });
  it('does not resurrect deleted cards', () => {
    const { merged } = mergeCards([], [card('a'), card('b')], ['a']);
    expect(merged.map((c) => c.id)).toEqual(['b']);
  });
});

describe('mergeStats', () => {
  it('never loses progress', () => {
    const s = mergeStats({ xp: 100, badges: ['first'], bestCombo: 3 }, { xp: 250, badges: ['combo5'], bestCombo: 1 });
    expect(s.xp).toBe(250);
    expect(s.bestCombo).toBe(3);
    expect(s.badges.sort()).toEqual(['combo5', 'first']);
  });
});
