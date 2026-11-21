// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('../api', () => ({ api: (...a: unknown[]) => apiMock(...a), ApiError: class extends Error {} }));

import { renderInbox } from './inbox';

const tick = () => new Promise((r) => setTimeout(r, 0));
const click = async (el: Element | undefined) => { (el as HTMLElement).click(); await tick(); await tick(); };
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

const CANDS = [
  { id: 'k1', title: '새 개념 A', note_md: '노트 A', questions: [], field_hint: '경제', status: 'pending',
    proposal: { action: 'merge', target_id: 'n1', merged_note_md: '합친', changes: ['예시 추가', '중복 제거'], reason: '같은 개념' } },
  { id: 'k2', title: '개념 B', note_md: '노트 B', questions: [], field_hint: null, status: 'pending', proposal: { action: 'new', target_id: null, reason: '' } },
  { id: 'k3', title: '개념 C', note_md: '노트 C', questions: [], field_hint: null, status: 'pending', proposal: { action: 'pair', target_id: 'n2', reason: '' } },
];

let notesCalls = 0;
beforeEach(() => {
  notesCalls = 0;
  apiMock.mockReset();
  apiMock.mockImplementation(async (p: string, init?: RequestInit) => {
    if (p === '/inbox') return { candidates: CANDS };
    if (p === '/notes') { notesCalls++; return { notes: [{ id: 'n1', title: '기존 노트1' }, { id: 'n2', title: '이웃 노트2' }] }; }
    if (p === '/fields') return { fields: [{ id: 'f1', name: '경제' }, { id: 'f2', name: '과학' }] };
    if (p === '/paste') return { created: 2 };
    if (init?.method === 'POST') return { ok: true };
    throw new Error('unexpected ' + p);
  });
});

describe('받은함', () => {
  it('제안을 제목과 함께 보여준다 (노트 목록은 한 번만 가져옴)', async () => {
    const root = document.createElement('div');
    await renderInbox(root);
    const cards = root.querySelectorAll('.cand');
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('기존 「기존 노트1」에 합치기');
    expect(cards[0].textContent).toContain('예시 추가');
    expect(cards[0].textContent).toContain('중복 제거');
    expect(cards[1].textContent).toContain('새 개념');
    expect(cards[2].textContent).toContain('「이웃 노트2」과 헷갈림 짝');
    expect(notesCalls).toBe(1);
  });
  it('[제안대로]는 제안의 action과 target_id로 확정한다', async () => {
    const root = document.createElement('div');
    await renderInbox(root);
    await click(btn(root.querySelectorAll('.cand')[0], '제안대로'));
    expect(apiMock).toHaveBeenCalledWith('/inbox/k1/confirm', {
      method: 'POST', body: JSON.stringify({ action: 'merge', target_id: 'n1' }),
    });
    expect(root.querySelectorAll('.cand')).toHaveLength(2);
  });
  it('[새로]는 고른 분야와 함께 new로, [버리기]는 discard로 확정한다', async () => {
    const root = document.createElement('div');
    await renderInbox(root);
    const card = root.querySelectorAll('.cand')[0];
    const sel = card.querySelector('select')!;
    sel.value = 'f2';
    await click(btn(card, '새로'));
    expect(apiMock).toHaveBeenCalledWith('/inbox/k1/confirm', {
      method: 'POST', body: JSON.stringify({ action: 'new', field_id: 'f2' }),
    });
    await click(btn(root.querySelectorAll('.cand')[0], '버리기'));
    expect(apiMock).toHaveBeenCalledWith('/inbox/k2/confirm', { method: 'POST', body: JSON.stringify({ action: 'discard' }) });
  });
  it('대화 붙여넣기: POST /paste 후 목록을 다시 불러온다', async () => {
    const root = document.createElement('div');
    await renderInbox(root);
    root.querySelector('textarea')!.value = '  대화 내용  ';
    await click(btn(root, '후보 만들기'));
    expect(apiMock).toHaveBeenCalledWith('/paste', { method: 'POST', body: JSON.stringify({ text: '대화 내용' }) });
    expect(apiMock.mock.calls.filter((c) => c[0] === '/inbox').length).toBe(2);
  });
  it('후보가 없으면 안내 문구', async () => {
    apiMock.mockImplementation(async (p: string) => (p === '/inbox' ? { candidates: [] } : p === '/fields' ? { fields: [] } : { notes: [] }));
    const root = document.createElement('div');
    await renderInbox(root);
    expect(root.textContent).toContain('받은함이 비었어요');
  });
});
