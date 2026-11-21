import { api } from '../api';
import { h, errText } from '../dom';
import { refreshBadge } from '../router';

type Proposal = { action?: 'merge' | 'new' | 'pair'; target_id?: string | null; merged_note_md?: string; changes?: string[]; reason?: string };
type Candidate = { id: string; title: string; note_md: string; field_hint: string | null; proposal: Proposal | null };
type Field = { id: string; name: string };

const PREVIEW = 160;
const preview = (s: string) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > PREVIEW ? t.slice(0, PREVIEW) + '…' : t; };

export async function renderInbox(root: HTMLElement, notice = ''): Promise<void> {
  const [{ candidates }, { notes }, { fields }] = await Promise.all([
    api<{ candidates: Candidate[] }>('/inbox'),
    api<{ notes: { id: string; title: string }[] }>('/notes'), // 합치기 대상 제목용(한 번만)
    api<{ fields: Field[] }>('/fields'),
  ]);
  const titles = new Map(notes.map((n) => [n.id, n.title]));

  root.replaceChildren(pasteBox((m) => void renderInbox(root, m).catch((e) => root.prepend(h('p', { class: 'error' }, errText(e))))));
  if (notice) root.firstElementChild?.querySelector('[role=status]')!.append(notice);
  const list = h('div', { class: 'cands' });
  root.append(list);
  const empty = () => { if (!list.querySelector('.cand')) list.replaceChildren(h('p', { class: 'empty' }, '받은함이 비었어요')); };
  for (const c of candidates) list.append(card(c, titles, fields, () => { void refreshBadge(); empty(); }));
  empty();
}

function pasteBox(onDone: (message: string) => void): HTMLElement {
  const text = h('textarea', { rows: '4', placeholder: 'AI와 나눈 대화를 여기에 붙여넣으세요 (ChatGPT 등)' });
  const msg = h('p', { class: 'hint', role: 'status' });
  const go = h('button', { class: 'primary' }, '후보 만들기');
  go.addEventListener('click', async () => {
    const t = text.value.trim();
    if (!t) { msg.textContent = '대화를 먼저 붙여넣어 주세요'; return; }
    go.disabled = true;
    msg.textContent = '정리하는 중이에요…';
    try {
      const r = await api<{ created: number }>('/paste', { method: 'POST', body: JSON.stringify({ text: t }) });
      onDone(`후보 ${r.created}개를 받았어요`);
    } catch (e) { msg.textContent = errText(e); go.disabled = false; }
  });
  return h('details', { class: 'paste' }, h('summary', {}, '대화 붙여넣기'), text, go, msg);
}

function proposalView(p: Proposal, titles: Map<string, string>): HTMLElement {
  const name = (id?: string | null) => (id && titles.get(id)) || '기존 노트';
  if (p.action === 'merge') {
    return h('div', { class: 'proposal' },
      h('p', {}, `기존 「${name(p.target_id)}」에 합치기`),
      p.changes?.length ? h('ul', {}, ...p.changes.map((x) => h('li', {}, x))) : null,
      p.reason ? h('p', { class: 'hint' }, p.reason) : null);
  }
  if (p.action === 'pair') {
    return h('div', { class: 'proposal' }, h('p', {}, `「${name(p.target_id)}」과 헷갈림 짝`), p.reason ? h('p', { class: 'hint' }, p.reason) : null);
  }
  return h('div', { class: 'proposal' }, h('p', {}, '새 개념'));
}

function card(c: Candidate, titles: Map<string, string>, fields: Field[], onGone: () => void): HTMLElement {
  const p = c.proposal ?? {};
  const field = h('select', { 'aria-label': '분야' },
    h('option', { value: '' }, c.field_hint ? `분야: ${c.field_hint} (자동)` : '분야: 미분류 (자동)'),
    ...fields.map((f) => h('option', { value: f.id }, f.name)));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const el = h('article', { class: 'card cand' },
    h('h3', {}, c.title), h('p', { class: 'preview' }, preview(c.note_md)), proposalView(p, titles), field);

  const confirm = async (body: Record<string, unknown>) => {
    const btns = [...el.querySelectorAll('button')];
    btns.forEach((b) => { b.disabled = true; });
    err.hidden = true;
    try {
      await api(`/inbox/${encodeURIComponent(c.id)}/confirm`, { method: 'POST', body: JSON.stringify(body) });
      el.remove();
      onGone();
    } catch (e) { err.textContent = errText(e); err.hidden = false; btns.forEach((b) => { b.disabled = false; }); }
  };
  const withField = (b: Record<string, unknown>) => (field.value ? { ...b, field_id: field.value } : b);

  const accept = p.action === 'merge' || p.action === 'pair'
    ? { action: p.action, target_id: p.target_id ?? undefined }
    : { action: 'new' };
  el.append(
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => void confirm(withField(accept)) }, '제안대로'),
      h('button', { onclick: () => void confirm(withField({ action: 'new' })) }, '새로'),
      h('button', { onclick: () => void confirm({ action: 'discard' }) }, '버리기')),
    err);
  return el;
}
