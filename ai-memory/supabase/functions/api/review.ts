// 복습 API: 오늘의 큐, 해설 공개, 채점·일정 갱신
import { HttpError } from './http.ts';
import type { Repo, UnitType } from './repo.ts';
import { schedule, seoulDayEnd, type Grade } from './srs.ts';
import type { gradeAnswer } from './ai.ts';

export interface ReviewDeps {
  repo: Repo;
  ai: { gradeAnswer: (question: string, note_md: string, answer: string) => ReturnType<typeof gradeAnswer> };
  now: () => Date;
  config: { daily_goal: number };
}

/** 노트는 포함하지 않는다(해설은 답을 시도한 뒤 reveal로만). */
export type ReviewItem = {
  unit_type: UnitType; unit_id: string; question: string; title: string;
  /** 화면에 보인 질문의 id (짝·기본 질문이면 null). 채점 때 last_asked_at 갱신에 쓴다. */
  question_id: string | null;
};
export type GradeFeedback = { hit: string[]; missed: string[]; comment: string };
export type GradeInput = {
  unit_type: UnitType; unit_id: string; mode: 'quick' | 'deep';
  grade?: Grade; answer?: string; question_id?: string | null;
};
export type GradeResult = { grade: Grade | null; feedback: GradeFeedback | null; next_due: string | null };

const DAY = 24 * 3600_000;
const GRADES: Grade[] = ['good', 'hard', 'again'];
const fallbackQuestion = (title: string) => `「${title}」을(를) 설명해 보세요.`;
const pairTitle = (a: string, b: string) => `「${a}」 vs 「${b}」`;

async function dueEntries(repo: Repo, until: Date) {
  const [cs, ps] = await Promise.all([repo.listDueConcepts(until), repo.listDuePairs(until)]);
  const all = [
    ...cs.map((c) => ({ t: 'concept' as const, due: c.due_at!, id: c.id, c })),
    ...ps.map((p) => ({ t: 'pair' as const, due: p.due_at!, id: p.id, p })),
  ];
  return all.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : 1));
}

/** 가장 오래전에 물어본(한 번도 안 물어봤으면 먼저) 질문, 같으면 id 순 */
function pickQuestion<Q extends { id: string; last_asked_at: string | null }>(qs: Q[]): Q | null {
  if (!qs.length) return null;
  return [...qs].sort((a, b) => {
    if (a.last_asked_at !== b.last_asked_at) {
      if (a.last_asked_at === null) return -1;
      if (b.last_asked_at === null) return 1;
      return a.last_asked_at < b.last_asked_at ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

export async function todayQueue(now: Date, d: ReviewDeps): Promise<ReviewItem[]> {
  const goal = Math.max(0, d.config.daily_goal);
  const entries = (await dueEntries(d.repo, seoulDayEnd(now))).slice(0, goal);
  const items: ReviewItem[] = [];
  for (const e of entries) {
    if (e.t === 'concept') {
      const q = pickQuestion(await d.repo.listQuestions(e.id));
      items.push({
        unit_type: 'concept', unit_id: e.id, title: e.c.title,
        question: q ? q.prompt : fallbackQuestion(e.c.title), question_id: q ? q.id : null,
      });
    } else {
      const [a, b] = await Promise.all([d.repo.getConcept(e.p.concept_a), d.repo.getConcept(e.p.concept_b)]);
      items.push({
        unit_type: 'pair', unit_id: e.id, title: pairTitle(a?.title ?? '?', b?.title ?? '?'),
        question: e.p.question, question_id: null,
      });
    }
  }
  return items;
}

/** 오늘(서울) 끝까지 복습할 전체 개수 (하루 목표로 자르지 않음) */
export async function todayCount(now: Date, d: ReviewDeps): Promise<number> {
  return (await dueEntries(d.repo, seoulDayEnd(now))).length;
}

/** 다음 서울 날짜에 새로 도래하는 개수 */
export async function tomorrowCount(now: Date, d: ReviewDeps): Promise<number> {
  const end = seoulDayEnd(now);
  const next = seoulDayEnd(new Date(end.getTime() + DAY));
  return (await dueEntries(d.repo, next)).filter((e) => new Date(e.due) > end).length;
}

export async function todayResponse(now: Date, d: ReviewDeps) {
  const [items, count, tomorrow] = await Promise.all([todayQueue(now, d), todayCount(now, d), tomorrowCount(now, d)]);
  return { items, remaining_after: Math.max(0, count - items.length), tomorrow };
}

const notFound = () => new HttpError(404, '복습 대상을 찾을 수 없어요');
const joinNotes = (a: { title: string; note_md: string }, b: { title: string; note_md: string }) =>
  `## ${a.title}\n\n${a.note_md}\n\n---\n\n## ${b.title}\n\n${b.note_md}`;

export async function reveal(d: ReviewDeps, unit_type: string, unit_id: string): Promise<{ note_md: string }> {
  if (unit_type === 'concept') {
    const c = await d.repo.getConcept(unit_id);
    if (!c) throw notFound();
    return { note_md: c.note_md };
  }
  if (unit_type === 'pair') {
    const p = await d.repo.getPair(unit_id);
    if (!p) throw notFound();
    const [a, b] = await Promise.all([d.repo.getConcept(p.concept_a), d.repo.getConcept(p.concept_b)]);
    if (!a || !b) throw notFound();
    return { note_md: joinNotes(a, b) };
  }
  throw new HttpError(400, 'unit_type이 올바르지 않아요');
}

export async function submitGrade(d: ReviewDeps, item: GradeInput): Promise<GradeResult> {
  if (item.unit_type !== 'concept' && item.unit_type !== 'pair') throw new HttpError(400, 'unit_type이 올바르지 않아요');
  if (item.mode !== 'quick' && item.mode !== 'deep') throw new HttpError(400, 'mode가 올바르지 않아요');
  if (item.grade !== undefined && !GRADES.includes(item.grade)) throw new HttpError(400, 'grade가 올바르지 않아요');
  const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
  if (item.mode === 'quick' && !item.grade) throw new HttpError(400, 'grade가 필요해요');
  if (item.mode === 'deep' && !answer) throw new HttpError(400, '답을 입력해 주세요');

  // 대상과 (AI 채점에 쓸) 질문·노트 확보
  let state: { stage: number; reviews: number; lapses: number };
  let question: string, note: string;
  let askedId: string | null = null;
  if (item.unit_type === 'concept') {
    const c = await d.repo.getConcept(item.unit_id);
    if (!c) throw notFound();
    state = c;
    const q = item.question_id ? (await d.repo.listQuestions(c.id)).find((x) => x.id === item.question_id) : undefined;
    question = q ? q.prompt : fallbackQuestion(c.title);
    askedId = q ? q.id : null;
    note = c.note_md;
  } else {
    const p = await d.repo.getPair(item.unit_id);
    if (!p) throw notFound();
    state = p;
    question = p.question;
    note = item.mode === 'deep' ? (await reveal(d, 'pair', p.id)).note_md : '';
  }

  let grade: Grade;
  let feedback: GradeFeedback | null = null;
  if (item.mode === 'deep') {
    const r = await d.ai.gradeAnswer(question, note, answer);
    if (!r) return { grade: null, feedback: null, next_due: null }; // 클라이언트가 자기채점으로 다시 보냄
    grade = r.grade;
    feedback = { hit: r.hit, missed: r.missed, comment: r.comment };
  } else {
    grade = item.grade!;
  }

  const now = d.now();
  const next = schedule({ stage: state.stage, reviews: state.reviews, lapses: state.lapses }, grade, now);
  const due_at = next.due.toISOString();
  await d.repo.updateSrs(item.unit_type, item.unit_id, { stage: next.stage, reviews: next.reviews, lapses: next.lapses, due_at });
  await d.repo.insertReviewLog({
    unit_type: item.unit_type, unit_id: item.unit_id, grade, mode: item.mode,
    answer: item.mode === 'deep' ? answer : null, feedback, at: now.toISOString(),
  });
  if (askedId) await d.repo.touchQuestion(askedId, now.toISOString());
  return { grade, feedback, next_due: due_at };
}
