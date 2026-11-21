import { api } from '../api';
import { h, errText } from '../dom';
import { renderMarkdown } from '../md';

type Summary = { id: string; title: string; field_id: string | null; updated_at: string; stage: number; due_at: string | null };
type Field = { id: string; name: string };
type Detail = {
  concept: { id: string; title: string; note_md: string; updated_at: string };
  versions: { id: string; created_at: string }[];
  questions: { id: string; kind: string; prompt: string }[];
};

const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
const KIND: Record<string, string> = { explain: '설명', apply: '적용', compare: '비교' };

export async function renderNotes(root: HTMLElement): Promise<void> {
  const { fields } = await api<{ fields: Field[] }>('/fields');
  const fieldName = new Map(fields.map((f) => [f.id, f.name]));

  const q = h('input', { type: 'search', placeholder: '제목·본문 검색', 'aria-label': '검색' });
  const field = h('select', { 'aria-label': '분야' }, h('option', { value: '' }, '모든 분야'), ...fields.map((f) => h('option', { value: f.id }, f.name)));
  const list = h('div', { class: 'note-list' });
  const detail = h('div', { class: 'note-detail' });

  const load = async () => {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set('q', q.value.trim());
    if (field.value) params.set('field', field.value);
    const qs = params.toString();
    try {
      const { notes } = await api<{ notes: Summary[] }>('/notes' + (qs ? `?${qs}` : ''));
      list.replaceChildren(...(notes.length
        ? notes.map((n) => h('button', { class: 'note-item', onclick: () => void open(n.id) },
            h('span', { class: 'note-title' }, n.title), h('span', { class: 'hint' }, fieldName.get(n.field_id ?? '') ?? '미분류')))
        : [h('p', { class: 'empty' }, '노트가 없어요')]));
    } catch (e) { list.replaceChildren(h('p', { class: 'error' }, errText(e))); }
  };

  const open = async (id: string) => {
    try {
      const d = await api<Detail>(`/notes/${encodeURIComponent(id)}`);
      const body = h('div', { class: 'note' });
      body.innerHTML = renderMarkdown(d.concept.note_md); // 이스케이프 후 변환
      const back = h('button', { onclick: () => { detail.replaceChildren(); root.classList.remove('reading'); } }, '← 목록');
      detail.replaceChildren(h('div', { class: 'note-body' },
        back, h('h2', {}, d.concept.title), h('p', { class: 'hint' }, `수정 ${fmt(d.concept.updated_at)}`), body,
        d.questions.length ? h('details', {}, h('summary', {}, `질문 ${d.questions.length}개`), h('ul', {}, ...d.questions.map((x) => h('li', {}, `[${KIND[x.kind] ?? x.kind}] ${x.prompt}`)))) : null,
        h('details', {}, h('summary', {}, `버전 기록 ${d.versions.length}개`),
          d.versions.length ? h('ul', {}, ...d.versions.map((v) => h('li', {}, `${fmt(v.created_at)} 이전 버전`))) : h('p', { class: 'hint' }, '합치기 전 기록이 없어요')),
      ));
      root.classList.add('reading');
      detail.scrollIntoView?.();
    } catch (e) { detail.replaceChildren(h('p', { class: 'error' }, errText(e))); }
  };

  let t: ReturnType<typeof setTimeout> | undefined;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => void load(), 250); });
  field.addEventListener('change', () => void load());
  root.replaceChildren(h('div', { class: 'note-filters' }, q, field), list, detail);
  await load();
}
