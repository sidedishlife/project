// 데이터 접근 경계: ingest(와 이후 작업)는 이 인터페이스만 본다. Supabase 구현 + 테스트용 메모리 구현.
import { db, dbErrorToHttp, warnMissingEnv } from './db.ts';
import { HttpError } from './http.ts';
import type { MaskTerm } from './masking.ts';

export type QuestionInput = { kind: 'explain' | 'apply' | 'compare'; prompt: string };
export interface ConceptRow {
  id: string; field_id: string | null; title: string; note_md: string;
  stage: number; due_at: string | null; reviews: number; lapses: number; created_at: string; updated_at: string;
}
export interface CandidateRow {
  id: string; source: 'claude' | 'chatgpt' | 'paste'; content_hash: string; title: string; note_md: string;
  questions: QuestionInput[]; field_hint: string | null; proposal: Record<string, unknown> | null;
  status: 'pending' | 'done' | 'discarded'; created_at: string;
}
export type NewCandidate = Omit<CandidateRow, 'id' | 'status'>;
export interface FieldRow { id: string; name: string }
export interface NoteSummary { id: string; title: string; field_id: string | null; updated_at: string; stage: number; due_at: string | null }
export interface QuestionRow { id: string; concept_id: string; kind: string; prompt: string; last_asked_at: string | null }

export interface PairRow {
  id: string; concept_a: string; concept_b: string; question: string;
  stage: number; due_at: string | null; reviews: number; lapses: number;
}
export type UnitType = 'concept' | 'pair';
export interface SrsPatch { stage: number; reviews: number; lapses: number; due_at: string }
export interface ReviewLogInput {
  unit_type: UnitType; unit_id: string; grade: string; mode: 'quick' | 'deep';
  answer: string | null; feedback: Record<string, unknown> | null; at: string;
}

export interface Repo {
  maskTerms(): Promise<MaskTerm[]>;
  // candidates
  hasCandidateHashSince(hash: string, since: Date): Promise<boolean>;
  /** 같은 해시가 since 이후에 없을 때만 한 문장으로 삽입. 삽입했으면 행, 아니면 null */
  insertCandidateIfNew(c: NewCandidate, since: Date): Promise<CandidateRow | null>;
  /** status가 pending일 때만 status를 바꾸고 그 행을 돌려줌 (없거나 이미 처리됐으면 null) */
  claimCandidate(id: string, status: 'done' | 'discarded'): Promise<CandidateRow | null>;
  releaseCandidate(id: string): Promise<void>;
  listPendingCandidates(): Promise<CandidateRow[]>;
  getCandidate(id: string): Promise<CandidateRow | null>;
  // concepts
  listConcepts(): Promise<ConceptRow[]>;
  getConcept(id: string): Promise<ConceptRow | null>;
  insertConcept(c: { field_id: string | null; title: string; note_md: string; stage: number; due_at: string }): Promise<ConceptRow>;
  updateConcept(id: string, patch: Partial<Pick<ConceptRow, 'note_md' | 'due_at' | 'updated_at'>>): Promise<void>;
  insertVersion(concept_id: string, note_md: string, created_at: string): Promise<void>;
  listVersions(concept_id: string): Promise<{ id: string; created_at: string }[]>;
  insertQuestions(concept_id: string, qs: QuestionInput[]): Promise<void>;
  listQuestions(concept_id: string): Promise<QuestionRow[]>;
  insertPair(p: { concept_a: string; concept_b: string; question: string; stage: number; due_at: string }): Promise<void>;
  searchNotes(q: string, field_id: string | null): Promise<NoteSummary[]>;
  // review
  /** due_at <= until 인 개념/짝 (due_at이 null이면 제외), due 오름차순 */
  listDueConcepts(until: Date): Promise<ConceptRow[]>;
  listDuePairs(until: Date): Promise<PairRow[]>;
  getPair(id: string): Promise<PairRow | null>;
  updateSrs(unit_type: UnitType, id: string, patch: SrsPatch): Promise<void>;
  touchQuestion(id: string, at: string): Promise<void>;
  insertReviewLog(row: ReviewLogInput): Promise<void>;
  /** since 이후 복습 기록에서 서로 다른 (unit_type, unit_id)의 수 */
  countReviewedSince(since: Date): Promise<number>;
  // fields
  listFields(): Promise<FieldRow[]>;
  findFieldByName(name: string): Promise<FieldRow | null>;
  insertField(name: string): Promise<FieldRow>;
}

// ── Supabase 구현 ──
// deno-lint-ignore no-explicit-any
const dbError = dbErrorToHttp;
const ok = <T>(r: { data: T; error: any }): T => {
  if (r.error) throw dbError(r.error);
  return r.data;
};

export function supabaseRepo(): Repo {
  warnMissingEnv();
  const summary = 'id, title, field_id, updated_at, stage, due_at';
  return {
    async maskTerms() {
      return ok(await db.from('mask_terms').select('term, alias')) ?? [];
    },
    async hasCandidateHashSince(hash, since) {
      const { count, error } = await db.from('candidates').select('id', { count: 'exact', head: true })
        .eq('content_hash', hash).gte('created_at', since.toISOString());
      if (error) throw dbError(error);
      return (count ?? 0) > 0;
    },
    async insertCandidateIfNew(c, since) {
      const id = ok(await db.rpc('insert_candidate_if_new', {
        p_source: c.source, p_hash: c.content_hash, p_title: c.title, p_note_md: c.note_md,
        p_questions: c.questions, p_field_hint: c.field_hint, p_proposal: c.proposal,
        p_created_at: c.created_at, p_since: since.toISOString(),
      })) as string | null;
      return id ? await this.getCandidate(id) : null;
    },
    async claimCandidate(id, status) {
      return (ok(await db.from('candidates').update({ status }).eq('id', id).eq('status', 'pending').select('*').maybeSingle()) ?? null) as CandidateRow | null;
    },
    async releaseCandidate(id) {
      ok(await db.from('candidates').update({ status: 'pending' }).eq('id', id));
    },
    async listPendingCandidates() {
      return (ok(await db.from('candidates').select('*').eq('status', 'pending').order('created_at')) ?? []) as CandidateRow[];
    },
    async getCandidate(id) {
      return (ok(await db.from('candidates').select('*').eq('id', id).maybeSingle()) ?? null) as CandidateRow | null;
    },
    async listConcepts() {
      return (ok(await db.from('concepts').select('*')) ?? []) as ConceptRow[];
    },
    async getConcept(id) {
      return (ok(await db.from('concepts').select('*').eq('id', id).maybeSingle()) ?? null) as ConceptRow | null;
    },
    async insertConcept(c) {
      return ok(await db.from('concepts').insert(c).select('*').single()) as ConceptRow;
    },
    async updateConcept(id, patch) {
      ok(await db.from('concepts').update(patch).eq('id', id));
    },
    async insertVersion(concept_id, note_md, created_at) {
      ok(await db.from('concept_versions').insert({ concept_id, note_md, created_at }));
    },
    async listVersions(concept_id) {
      return ok(await db.from('concept_versions').select('id, created_at').eq('concept_id', concept_id).order('created_at', { ascending: false })) ?? [];
    },
    async insertQuestions(concept_id, qs) {
      if (qs.length) ok(await db.from('questions').insert(qs.map((q) => ({ concept_id, kind: q.kind, prompt: q.prompt }))));
    },
    async listQuestions(concept_id) {
      return (ok(await db.from('questions').select('*').eq('concept_id', concept_id)) ?? []) as QuestionRow[];
    },
    async insertPair(p) {
      ok(await db.from('pairs').insert(p));
    },
    async searchNotes(q, field_id) {
      let query = db.from('concepts').select(summary).order('updated_at', { ascending: false });
      if (field_id) query = query.eq('field_id', field_id);
      // ilike 와일드카드(% _ \)는 이스케이프하고, 따옴표로 감싼 PostgREST 값 안의 \ 와 "도 이스케이프
      const s = q.trim().replace(/[\\%_]/g, '\\$&').replace(/[\\"]/g, '\\$&');
      if (s) query = query.or(`title.ilike."%${s}%",note_md.ilike."%${s}%"`);
      return (ok(await query) ?? []) as NoteSummary[];
    },
    async listDueConcepts(until) {
      return (ok(await db.from('concepts').select('*').lte('due_at', until.toISOString()).order('due_at')) ?? []) as ConceptRow[];
    },
    async listDuePairs(until) {
      return (ok(await db.from('pairs').select('*').lte('due_at', until.toISOString()).order('due_at')) ?? []) as PairRow[];
    },
    async getPair(id) {
      return (ok(await db.from('pairs').select('*').eq('id', id).maybeSingle()) ?? null) as PairRow | null;
    },
    async updateSrs(unit_type, id, patch) {
      ok(await db.from(unit_type === 'concept' ? 'concepts' : 'pairs').update(patch).eq('id', id));
    },
    async touchQuestion(id, at) {
      ok(await db.from('questions').update({ last_asked_at: at }).eq('id', id));
    },
    async insertReviewLog(row) {
      ok(await db.from('review_log').insert(row));
    },
    async countReviewedSince(since) {
      const rows = (ok(await db.from('review_log').select('unit_type, unit_id').gte('at', since.toISOString())) ?? []) as { unit_type: string; unit_id: string }[];
      return new Set(rows.map((r) => `${r.unit_type}:${r.unit_id}`)).size;
    },
    async listFields() {
      return (ok(await db.from('fields').select('id, name').order('name')) ?? []) as FieldRow[];
    },
    async findFieldByName(name) {
      return (ok(await db.from('fields').select('id, name').eq('name', name).maybeSingle()) ?? null) as FieldRow | null;
    },
    async insertField(name) {
      const { data, error } = await db.from('fields').insert({ name }).select('id, name').single();
      if (error) {
        if (error.code === '23505') { // 동시에 같은 이름이 만들어진 경우
          const f = await this.findFieldByName(name);
          if (f) return f;
        }
        throw dbError(error);
      }
      return data as FieldRow;
    },
  };
}

// ── 메모리 구현 (테스트용) ──
export interface MemoryRepo extends Repo {
  data: {
    concepts: ConceptRow[]; versions: { id: string; concept_id: string; note_md: string; created_at: string }[];
    questions: QuestionRow[]; pairs: PairRow[];
    reviewLog: ReviewLogInput[];
    candidates: CandidateRow[]; fields: FieldRow[]; mask: MaskTerm[];
  };
}

export function memoryRepo(seed: { mask?: MaskTerm[] } = {}): MemoryRepo {
  const data: MemoryRepo['data'] = { concepts: [], versions: [], questions: [], pairs: [], reviewLog: [], candidates: [], fields: [], mask: seed.mask ?? [] };
  const uid = () => crypto.randomUUID();
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    data,
    maskTerms: async () => clone(data.mask),
    hasCandidateHashSince: async (hash, since) =>
      data.candidates.some((c) => c.content_hash === hash && new Date(c.created_at) >= since),
    insertCandidateIfNew: async (c, since) => {
      if (data.candidates.some((x) => x.content_hash === c.content_hash && new Date(x.created_at) >= since)) return null;
      const row: CandidateRow = { ...clone(c), id: uid(), status: 'pending' };
      data.candidates.push(row);
      return clone(row);
    },
    claimCandidate: async (id, status) => {
      const row = data.candidates.find((c) => c.id === id && c.status === 'pending');
      if (!row) return null;
      row.status = status;
      return clone(row);
    },
    releaseCandidate: async (id) => { data.candidates.find((c) => c.id === id)!.status = 'pending'; },
    listPendingCandidates: async () => clone(data.candidates.filter((c) => c.status === 'pending')),
    getCandidate: async (id) => clone(data.candidates.find((c) => c.id === id) ?? null),
    listConcepts: async () => clone(data.concepts),
    getConcept: async (id) => clone(data.concepts.find((c) => c.id === id) ?? null),
    insertConcept: async (c) => {
      const t = new Date().toISOString();
      const row: ConceptRow = { id: uid(), reviews: 0, lapses: 0, created_at: t, updated_at: t, ...clone(c) };
      data.concepts.push(row);
      return clone(row);
    },
    updateConcept: async (id, patch) => { Object.assign(data.concepts.find((c) => c.id === id)!, patch); },
    insertVersion: async (concept_id, note_md, created_at) => { data.versions.push({ id: uid(), concept_id, note_md, created_at }); },
    listVersions: async (cid) => data.versions.filter((v) => v.concept_id === cid).map((v) => ({ id: v.id, created_at: v.created_at }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    insertQuestions: async (concept_id, qs) => {
      for (const q of qs) data.questions.push({ id: uid(), concept_id, kind: q.kind, prompt: q.prompt, last_asked_at: null });
    },
    listQuestions: async (cid) => clone(data.questions.filter((q) => q.concept_id === cid)),
    insertPair: async (p) => { data.pairs.push({ id: uid(), reviews: 0, lapses: 0, ...clone(p) }); },
    listDueConcepts: async (until) => clone(data.concepts.filter((c) => c.due_at && new Date(c.due_at) <= until)
      .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))),
    listDuePairs: async (until) => clone(data.pairs.filter((p) => p.due_at && new Date(p.due_at) <= until)
      .sort((a, b) => (a.due_at! < b.due_at! ? -1 : 1))),
    getPair: async (id) => clone(data.pairs.find((p) => p.id === id) ?? null),
    updateSrs: async (t, id, patch) => {
      Object.assign((t === 'concept' ? data.concepts : data.pairs).find((x) => x.id === id)!, patch);
    },
    touchQuestion: async (id, at) => { data.questions.find((q) => q.id === id)!.last_asked_at = at; },
    insertReviewLog: async (row) => { data.reviewLog.push(clone(row)); },
    countReviewedSince: async (since) =>
      new Set(data.reviewLog.filter((r) => new Date(r.at) >= since).map((r) => `${r.unit_type}:${r.unit_id}`)).size,
    searchNotes: async (q, field_id) => {
      const s = q.trim().toLowerCase();
      return data.concepts
        .filter((c) => (!field_id || c.field_id === field_id) && (!s || c.title.toLowerCase().includes(s) || c.note_md.toLowerCase().includes(s)))
        .map(({ id, title, field_id, updated_at, stage, due_at }) => ({ id, title, field_id, updated_at, stage, due_at }));
    },
    listFields: async () => clone([...data.fields].sort((a, b) => a.name.localeCompare(b.name))),
    findFieldByName: async (name) => clone(data.fields.find((f) => f.name === name) ?? null),
    insertField: async (name) => {
      const f = { id: uid(), name };
      data.fields.push(f);
      return clone(f);
    },
  };
}
