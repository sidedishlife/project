import { api } from '../api';
import { h, errText } from '../dom';
import { renderMarkdown } from '../md';

export type Mode = 'quick' | 'deep';
type Grade = 'good' | 'hard' | 'again';
type Item = { unit_type: 'concept' | 'pair'; unit_id: string; question: string; title: string; question_id: string | null };
type Today = { items: Item[]; remaining_after: number; tomorrow: number };
type Feedback = { hit: string[]; missed: string[]; comment: string };
type GradeResult = { grade: Grade | null; feedback: Feedback | null; next_due: string | null };

/** 서울 22:00 이상 ~ 05:00 미만은 깊은 모드(잠들기 전), 그 외 빠른 모드 */
export function defaultMode(now: Date): Mode {
  const hour = (now.getUTCHours() + 9) % 24; // 서울은 UTC+9 고정(서머타임 없음)
  return hour >= 22 || hour < 5 ? 'deep' : 'quick';
}

let sessionMode: Mode | null = null; // 화면을 다시 열어도 이번 접속 동안만 유지

const GRADES: { grade: Grade; label: string }[] = [
  { grade: 'good', label: '알았음' },
  { grade: 'hard', label: '애매' },
  { grade: 'again', label: '몰랐음' },
];

export async function renderReview(root: HTMLElement, opts: { mode?: Mode } = {}): Promise<void> {
  const nowQ = new URLSearchParams(location.search).get('now'); // 개발용: 목록만 시간 이동
  const today = await api<Today>(nowQ ? `/review/today?now=${encodeURIComponent(nowQ)}` : '/review/today');
  let mode: Mode = opts.mode ?? sessionMode ?? defaultMode(new Date());
  let idx = 0;

  const paint = () => {
    root.replaceChildren();
    if (idx >= today.items.length) return root.append(doneCard(today));
    const toggle = h('button', {
      class: 'mode-toggle',
      onclick: () => { mode = mode === 'quick' ? 'deep' : 'quick'; sessionMode = mode; paint(); },
    }, mode === 'quick' ? '빠른 모드 (눌러서 깊은 모드)' : '깊은 모드 (눌러서 빠른 모드)');
    root.append(
      h('p', { class: 'hint' }, `${idx + 1} / ${today.items.length}`),
      toggle,
      (mode === 'quick' ? quickCard : deepCard)(today.items[idx], () => { idx++; paint(); }),
    );
  };
  paint();
}

function doneCard(t: Today): HTMLElement {
  const more = t.remaining_after > 0 ? `오늘 목표만큼 했어요. 더 남은 ${t.remaining_after}개는 내일 이어서 해요.` : '';
  return h('div', { class: 'card done' },
    h('h2', {}, '오늘 끝!'),
    h('p', {}, `내일 ${t.tomorrow}개`),
    more ? h('p', { class: 'hint' }, more) : null);
}

const questionBlock = (it: Item) =>
  h('div', { class: 'question' }, h('p', { class: 'hint' }, it.title), h('p', { class: 'q-text' }, it.question));

const noteBlock = (md: string) => {
  const d = h('div', { class: 'note' });
  d.innerHTML = renderMarkdown(md); // renderMarkdown 은 HTML 을 이스케이프한다
  return d;
};

async function fetchNote(it: Item): Promise<string> {
  return (await api<{ note_md: string }>(`/review/${it.unit_type}/${encodeURIComponent(it.unit_id)}/reveal`)).note_md;
}

function gradeButtons(card: HTMLElement, onPick: (g: Grade) => Promise<void>): HTMLElement {
  const box = h('div', { class: 'grades' });
  const btns = GRADES.map((g) => h('button', { class: g.grade === 'good' ? 'primary' : '' }, g.label));
  btns.forEach((b, i) => {
    b.addEventListener('click', () => {
      card.querySelector('.error')?.remove();
      btns.forEach((x) => { x.disabled = true; }); // 한 번만 보내도록 전부 잠근다
      onPick(GRADES[i].grade).catch((e) => {
        btns.forEach((x) => { x.disabled = false; });
        card.append(h('p', { class: 'error', role: 'alert' }, errText(e)));
      });
    });
  });
  box.append(...btns);
  return box;
}

function run(card: HTMLElement, btn: HTMLButtonElement, fn: () => Promise<void>): void {
  card.querySelector('.error')?.remove();
  btn.disabled = true;
  fn().catch((e) => { btn.disabled = false; card.append(h('p', { class: 'error', role: 'alert' }, errText(e))); });
}

function quickCard(it: Item, next: () => void): HTMLElement {
  const card = h('div', { class: 'card' }, questionBlock(it));
  const recall = h('button', { class: 'primary' }, '떠올렸어요');
  card.append(recall);
  recall.addEventListener('click', () => run(card, recall, async () => {
    const md = await fetchNote(it); // 시도(떠올렸어요) 뒤에만 해설을 가져온다
    recall.remove();
    card.append(noteBlock(md), gradeButtons(card, async (grade) => {
      await api('/review/grade', { method: 'POST', body: JSON.stringify({ unit_type: it.unit_type, unit_id: it.unit_id, mode: 'quick', grade, question_id: it.question_id }) });
      next();
    }));
  }));
  return card;
}

function deepCard(it: Item, next: () => void): HTMLElement {
  const card = h('div', { class: 'card' }, questionBlock(it));
  const answer = h('textarea', { rows: '6', placeholder: '내 말로 적어 보세요 (키보드의 마이크 버튼으로 말해서 받아쓸 수도 있어요)' });
  const submit = h('button', { class: 'primary' }, '채점');
  card.append(answer, submit);

  const post = (extra: Record<string, unknown>, text: string) =>
    api<GradeResult>('/review/grade', {
      method: 'POST',
      body: JSON.stringify({ unit_type: it.unit_type, unit_id: it.unit_id, mode: 'deep', answer: text, ...extra, question_id: it.question_id }),
    });

  submit.addEventListener('click', () => {
    const text = answer.value.trim();
    if (!text) { card.querySelector('.error')?.remove(); card.append(h('p', { class: 'error', role: 'alert' }, '답을 먼저 적어 주세요')); return; }
    run(card, submit, async () => {
      const r = await post({}, text);
      // 답을 낸 뒤에만 해설을 가져온다. 이미 채점이 기록됐으니 해설 실패로 다시 채점하게 두지 않는다
      const md = await fetchNote(it).catch(() => '해설을 불러오지 못했어요.');
      answer.disabled = true;
      submit.remove();
      if (r.grade === null) { // AI 채점 실패: 자기채점으로 같은 답을 다시 보냄
        card.append(h('p', { class: 'hint' }, '자동 채점을 못 했어요. 해설을 보고 직접 골라 주세요.'), noteBlock(md),
          gradeButtons(card, async (grade) => { await post({ grade }, text); next(); }));
        return;
      }
      card.append(feedbackBlock(r), noteBlock(md), h('button', { class: 'primary', onclick: next }, '다음'));
    });
  });
  return card;
}

const GRADE_LABEL: Record<Grade, string> = { good: '알았음', hard: '애매', again: '몰랐음' };

function feedbackBlock(r: GradeResult): HTMLElement {
  const list = (title: string, xs: string[]) =>
    xs.length ? h('div', {}, h('strong', {}, title), h('ul', {}, ...xs.map((x) => h('li', {}, x)))) : null;
  return h('div', { class: 'feedback' },
    h('p', {}, `채점: ${GRADE_LABEL[r.grade!]}`),
    list('맞힌 것', r.feedback?.hit ?? []),
    list('빠진 것', r.feedback?.missed ?? []),
    r.feedback?.comment ? h('p', {}, r.feedback.comment) : null);
}
