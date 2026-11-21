// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('../api', () => ({ api: (...a: unknown[]) => apiMock(...a), ApiError: class extends Error {} }));

import { defaultMode, renderReview } from './review';

const ITEM = { unit_type: 'concept', unit_id: 'c1', question: '질문 하나?', title: '개념1', question_id: 'q1' };
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = async (root: HTMLElement, text: string) => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`버튼 없음: ${text}\n${root.innerHTML}`);
  b.click();
  await tick(); await tick();
};
const calls = () => apiMock.mock.calls.map((c) => c[0] as string);

beforeEach(() => { apiMock.mockReset(); history.replaceState(null, '', '/'); });

describe('defaultMode (서울 22:00 ≤ t < 05:00 → deep)', () => {
  it.each([
    ['2026-11-21T14:00:00Z', 'deep'], // 서울 23:00
    ['2026-11-21T13:00:00Z', 'deep'], // 22:00 정각
    ['2026-11-21T12:59:00Z', 'quick'], // 21:59
    ['2026-11-21T19:59:00Z', 'deep'], // 04:59
    ['2026-11-21T20:00:00Z', 'quick'], // 05:00 정각
    ['2026-11-20T23:00:00Z', 'quick'], // 서울 08:00
    ['2026-11-21T15:30:00Z', 'deep'], // 서울 00:30 (UTC로는 15:30)
  ])('%s → %s', (iso, mode) => {
    expect(defaultMode(new Date(iso))).toBe(mode);
  });
});

describe('빠른 모드', () => {
  it('[떠올렸어요] 전에는 해설(reveal)을 부르지 않고, 누른 뒤 등급 3버튼이 나온다', async () => {
    apiMock.mockImplementation(async (p: string) => {
      if (p.startsWith('/review/today')) return { items: [ITEM], remaining_after: 0, tomorrow: 4 };
      if (p.endsWith('/reveal')) return { note_md: '## 해설\n**핵심**' };
      return { grade: 'good', feedback: null, next_due: 'x' };
    });
    const root = document.createElement('div');
    await renderReview(root, { mode: 'quick' });
    expect(root.textContent).toContain('질문 하나?');
    expect(calls().some((c) => c.endsWith('/reveal'))).toBe(false);
    expect(root.textContent).not.toContain('핵심');

    await click(root, '떠올렸어요');
    expect(calls()).toContain('/review/concept/c1/reveal');
    expect(root.innerHTML).toContain('<strong>핵심</strong>');

    await click(root, '알았음');
    expect(apiMock).toHaveBeenLastCalledWith('/review/grade', {
      method: 'POST',
      body: JSON.stringify({ unit_type: 'concept', unit_id: 'c1', mode: 'quick', grade: 'good', question_id: 'q1' }),
    });
    expect(root.textContent).toContain('오늘 끝');
    expect(root.textContent).toContain('내일 4개');
  });
});

describe('깊은 모드', () => {
  const setup = (gradeResp: unknown) => {
    apiMock.mockImplementation(async (p: string) => {
      if (p.startsWith('/review/today')) return { items: [ITEM], remaining_after: 0, tomorrow: 0 };
      if (p.endsWith('/reveal')) return { note_md: '해설 본문' };
      return gradeResp;
    });
  };
  it('채점이 되면 맞힌 것/빠진 것과 해설을 보여주고 [다음]', async () => {
    setup({ grade: 'hard', feedback: { hit: ['A를 짚음'], missed: ['B 빠짐'], comment: '거의 맞아요' }, next_due: 'x' });
    const root = document.createElement('div');
    await renderReview(root, { mode: 'deep' });
    expect(calls().some((c) => c.endsWith('/reveal'))).toBe(false);
    root.querySelector('textarea')!.value = '내 답';
    await click(root, '채점');
    expect(apiMock).toHaveBeenCalledWith('/review/grade', {
      method: 'POST',
      body: JSON.stringify({ unit_type: 'concept', unit_id: 'c1', mode: 'deep', answer: '내 답', question_id: 'q1' }),
    });
    expect(root.textContent).toContain('A를 짚음');
    expect(root.textContent).toContain('B 빠짐');
    expect(root.textContent).toContain('해설 본문');
    await click(root, '다음');
    expect(root.textContent).toContain('오늘 끝');
  });
  it('grade가 null이면 자기채점 3버튼이 같은 답으로 deep+grade를 다시 보낸다', async () => {
    setup({ grade: null, feedback: null, next_due: null });
    const root = document.createElement('div');
    await renderReview(root, { mode: 'deep' });
    root.querySelector('textarea')!.value = '내 답';
    await click(root, '채점');
    expect(root.textContent).toContain('해설 본문');
    expect(calls()).toContain('/review/concept/c1/reveal');

    apiMock.mockImplementation(async () => ({ grade: 'again', feedback: null, next_due: 'y' }));
    await click(root, '몰랐음');
    expect(apiMock).toHaveBeenLastCalledWith('/review/grade', {
      method: 'POST',
      body: JSON.stringify({ unit_type: 'concept', unit_id: 'c1', mode: 'deep', answer: '내 답', grade: 'again', question_id: 'q1' }),
    });
  });
  it('빈 답은 보내지 않는다', async () => {
    setup({});
    const root = document.createElement('div');
    await renderReview(root, { mode: 'deep' });
    await click(root, '채점');
    expect(calls().filter((c) => c === '/review/grade')).toHaveLength(0);
  });
});

describe('?now= 개발용 쿼리', () => {
  it('GET /review/today 에만 그대로 넘긴다', async () => {
    history.replaceState(null, '', '/?now=2026-12-01T00:00:00Z');
    apiMock.mockResolvedValue({ items: [], remaining_after: 0, tomorrow: 2 });
    const root = document.createElement('div');
    await renderReview(root, { mode: 'quick' });
    expect(apiMock).toHaveBeenCalledWith(`/review/today?now=${encodeURIComponent('2026-12-01T00:00:00Z')}`);
    expect(root.textContent).toContain('오늘 끝');
    expect(root.textContent).toContain('내일 2개');
  });
  it('쿼리가 없으면 붙이지 않는다', async () => {
    apiMock.mockResolvedValue({ items: [], remaining_after: 0, tomorrow: 0 });
    await renderReview(document.createElement('div'), { mode: 'quick' });
    expect(apiMock).toHaveBeenCalledWith('/review/today');
  });
});
