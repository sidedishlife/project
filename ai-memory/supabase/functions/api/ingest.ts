// 후보 받기(submit/paste)와 받은함 확정(confirm)
import { HttpError } from './http.ts';
import { applyMask, type MaskTerm } from './masking.ts';
import { firstDue, onMerge, type Slots } from './srs.ts';
import type { CandidateInput } from './types.ts';
import type { CandidateRow, ConceptRow, Repo } from './repo.ts';
import type * as Ai from './ai.ts';

export const MAX_PER_SUBMIT = 3;
const DAY = 86400_000;

export interface IngestDeps {
  repo: Repo;
  ai: {
    matchConcept: typeof Ai.matchConcept;
    mergeNote: typeof Ai.mergeNote;
    compareQuestion: typeof Ai.compareQuestion;
    extractCandidates: typeof Ai.extractCandidates;
  };
  now: () => Date;
  config: { mask_enabled: boolean; slots: Slots };
}

export type Decision = { action: 'merge' | 'new' | 'pair' | 'discard'; target_id?: string; field_id?: string };

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const maskedTerms = async (d: IngestDeps): Promise<MaskTerm[] | null> =>
  d.config.mask_enabled ? await d.repo.maskTerms() : null;

export async function submitCandidates(
  d: IngestDeps,
  source: 'claude' | 'chatgpt' | 'paste',
  items: CandidateInput[],
): Promise<{ created: number; skipped_duplicates: number; over_limit: number }> {
  const kept = items.slice(0, MAX_PER_SUBMIT);
  const over_limit = items.length - kept.length;
  const terms = await maskedTerms(d);
  const now = d.now();
  const since = new Date(now.getTime() - DAY);
  let existing: { id: string; title: string; summary: string; note_md: string }[] | null = null;
  let created = 0, skipped_duplicates = 0;

  for (const raw of kept) {
    const m = (s: string) => (terms ? applyMask(s, terms) : s);
    const title = m(raw.title), note_md = m(raw.note_md);
    const questions = raw.questions.map((q) => ({ kind: q.kind, prompt: m(q.prompt) }));
    const content_hash = await sha256Hex(title + '\n' + note_md);
    if (await d.repo.hasCandidateHashSince(content_hash, since)) { skipped_duplicates++; continue; }

    existing ??= (await d.repo.listConcepts()).map((c) => ({ id: c.id, title: c.title, summary: c.note_md.slice(0, 200), note_md: c.note_md }));
    const match = existing.length
      ? await d.ai.matchConcept({ title, note_md }, existing.map(({ id, title, summary }) => ({ id, title, summary })))
      : null; // 비교할 개념이 없으면 AI를 부르지 않는다
    let proposal: Record<string, unknown> = { action: 'new' };
    if (match) {
      proposal = { ...match };
      if (match.action === 'merge') {
        const target = existing.find((c) => c.id === match.target_id);
        const draft = target ? await d.ai.mergeNote(target.note_md, note_md) : null;
        // base_hash: 초안이 어느 노트를 바탕으로 만들어졌는지. 확정 때 노트가 바뀌었으면 초안을 버린다
        if (target && draft) { proposal.merged_note_md = draft.note_md; proposal.changes = draft.changes; proposal.base_hash = await sha256Hex(target.note_md); }
      }
    }
    // AI 호출을 거친 뒤라 다시 확인해야 하므로, 삽입 자체가 '없을 때만' 조건부로 일어난다
    const inserted = await d.repo.insertCandidateIfNew({
      source, content_hash, title, note_md, questions,
      field_hint: raw.field_hint ? m(raw.field_hint) : null,
      proposal, created_at: now.toISOString(),
    }, since);
    if (inserted) created++; else skipped_duplicates++;
  }
  return { created, skipped_duplicates, over_limit };
}

export async function pasteConversation(d: IngestDeps, text: string): Promise<{ created: number }> {
  const terms = await maskedTerms(d); // 대화 원문도 AI로 보내기 전에 가린다
  const found = await d.ai.extractCandidates(terms ? applyMask(text, terms) : text);
  if (found === null) throw new HttpError(502, 'AI가 대화를 정리하지 못했어요. 잠시 뒤 다시 시도해 주세요');
  const r = await submitCandidates(d, 'paste', found);
  return { created: r.created };
}

const UNCLASSIFIED = '미분류';

async function resolveField(d: IngestDeps, cand: CandidateRow, field_id?: string): Promise<string> {
  if (field_id) return field_id;
  const name = cand.field_hint?.trim() || UNCLASSIFIED;
  return (await d.repo.findFieldByName(name) ?? await d.repo.insertField(name)).id;
}

async function createConcept(d: IngestDeps, cand: CandidateRow, field_id?: string): Promise<ConceptRow> {
  const fid = await resolveField(d, cand, field_id);
  const c = await d.repo.insertConcept({
    field_id: fid, title: cand.title, note_md: cand.note_md, stage: 0,
    due_at: firstDue(d.now(), d.config.slots).toISOString(),
  });
  await d.repo.insertQuestions(c.id, cand.questions);
  return c;
}

export async function confirmCandidate(d: IngestDeps, id: string, decision: Decision): Promise<void> {
  if (!['merge', 'new', 'pair', 'discard'].includes(decision.action)) throw new HttpError(400, '알 수 없는 결정이에요');
  if (!await d.repo.getCandidate(id)) throw new HttpError(404, '없는 후보예요');
  // 먼저 차지한다: 동시에 두 번 눌려도 한 번만 처리됨
  const cand = await d.repo.claimCandidate(id, decision.action === 'discard' ? 'discarded' : 'done');
  if (!cand) throw new HttpError(409, '이미 처리한 후보예요');
  if (decision.action === 'discard') return;
  try {
    await apply(d, cand, decision);
  } catch (e) {
    await d.repo.releaseCandidate(id); // 실패하면 받은함에 다시 남긴다
    throw e;
  }
}

async function apply(d: IngestDeps, cand: CandidateRow, decision: Decision): Promise<void> {
  const now = d.now();
  const proposal = (cand.proposal ?? {}) as { action?: string; target_id?: string | null; merged_note_md?: string; base_hash?: string };

  if (decision.action === 'new') {
    await createConcept(d, cand, decision.field_id);
    return;
  }
  const targetId = decision.target_id ?? proposal.target_id ?? undefined;
  if (!targetId) throw new HttpError(400, '합치거나 짝지을 개념(target_id)이 필요해요');
  const target = await d.repo.getConcept(targetId);
  if (!target) throw new HttpError(404, '대상 개념을 찾을 수 없어요');

  if (decision.action === 'merge') {
    // 제출 때 만든 초안은 그때의 노트 기준이므로, 노트가 그대로일 때만 쓴다
    const fresh = proposal.action === 'merge' && proposal.target_id === targetId && proposal.base_hash === await sha256Hex(target.note_md);
    let merged = fresh ? proposal.merged_note_md : undefined;
    merged ??= (await d.ai.mergeNote(target.note_md, cand.note_md))?.note_md;
    merged ??= `${target.note_md}\n\n---\n\n${cand.note_md}`;
    await d.repo.insertVersion(target.id, target.note_md, now.toISOString());
    await d.repo.updateConcept(target.id, {
      note_md: merged,
      updated_at: now.toISOString(),
      due_at: onMerge(target.due_at ? new Date(target.due_at) : new Date(now.getTime() + DAY), now).toISOString(),
    });
    await d.repo.insertQuestions(target.id, cand.questions);
  } else {
    const created = await createConcept(d, cand, decision.field_id ?? target.field_id ?? undefined);
    const [a, b] = created.id < target.id ? [created, target] : [target, created];
    const question = await d.ai.compareQuestion(
      { title: a.title, note_md: a.note_md }, { title: b.title, note_md: b.note_md },
    ) ?? `「${a.title}」와 「${b.title}」의 차이는 무엇인가요?`;
    await d.repo.insertPair({
      concept_a: a.id, concept_b: b.id, question, stage: 0,
      due_at: firstDue(now, d.config.slots).toISOString(),
    });
  }
}

// ── 읽기용 (라우트에서 사용) ──
export async function listNotes(repo: Repo, q: string, field: string | null) {
  return await repo.searchNotes(q, field);
}

export async function getNote(repo: Repo, id: string) {
  const concept = await repo.getConcept(id);
  if (!concept) throw new HttpError(404, '없는 노트예요');
  return { concept, versions: await repo.listVersions(id), questions: await repo.listQuestions(id) };
}
