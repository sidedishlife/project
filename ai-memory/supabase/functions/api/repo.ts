// 데이터 접근 경계: ingest(와 이후 작업)는 이 인터페이스만 본다. Supabase 구현 + 테스트용 메모리 구현.
import { db } from './db.ts';
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

export interface Repo {
  maskTerms(): Promise<MaskTerm[]>;
  // candidates
  hasCandidateHashSince(hash: string, since: Date): Promise<boolean>;
  insertCandidate(c: NewCandidate): Promise<CandidateRow>;
  listPendingCandidates(): Promise<CandidateRow[]>;
  getCandidate(id: string): Promise<CandidateRow | null>;
  updateCandidate(id: string, patch: Partial<Pick<CandidateRow, 'status' | 'proposal'>>): Promise<void>;
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
  // fields
  listFields(): Promise<FieldRow[]>;
  findFieldByName(name: string): Promise<FieldRow | null>;
  insertField(name: string): Promise<FieldRow>;
}

// ── Supabase 구현 ──
// deno-lint-ignore no-explicit-any
const ok = <T>(r: { data: T; error: any }): T => {
  if (r.error) throw new HttpError(500, r.error.message);
  return r.data;
};

export function supabaseRepo(): Repo {
  const summary = 'id, title, field_id, updated_at, stage, due_at';
  return {
    async maskTerms() {
      return ok(await db.from('mask_terms').select('term, alias')) ?? [];
    },
    async hasCandidateHashSince(hash, since) {
      const { count, error } = await db.from('candidates').select('id', { count: 'exact', head: true })
        .eq('content_hash', hash).gte('created_at', since.toISOString());
      if (error) throw new HttpError(500, error.message);
      return (count ?? 0) > 0;
    },
    async insertCandidate(c) {
      return ok(await db.from('candidates').insert(c).select('*').single()) as CandidateRow;
    },
    async listPendingCandidates() {
      return (ok(await db.from('candidates').select('*').eq('status', 'pending').order('created_at')) ?? []) as CandidateRow[];
    },
    async getCandidate(id) {
      return (ok(await db.from('candidates').select('*').eq('id', id).maybeSingle()) ?? null) as CandidateRow | null;
    },
    async updateCandidate(id, patch) {
      ok(await db.from('candidates').update(patch).eq('id', id));
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
      // PostgREST or-필터 구분자가 섞이지 않게 특수문자를 공백으로
      const s = q.replace(/[,()"\\%*_]/g, ' ').trim();
      if (s) query = query.or(`title.ilike."%${s}%",note_md.ilike."%${s}%"`);
      return (ok(await query) ?? []) as NoteSummary[];
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
        throw new HttpError(500, error.message);
      }
      return data as FieldRow;
    },
  };
}

// ── 메모리 구현 (테스트용) ──
export interface MemoryRepo extends Repo {
  data: {
    concepts: ConceptRow[]; versions: { id: string; concept_id: string; note_md: string; created_at: string }[];
    questions: QuestionRow[]; pairs: { concept_a: string; concept_b: string; question: string; stage: number; due_at: string }[];
    candidates: CandidateRow[]; fields: FieldRow[]; mask: MaskTerm[];
  };
}

export function memoryRepo(seed: { mask?: MaskTerm[] } = {}): MemoryRepo {
  const data: MemoryRepo['data'] = { concepts: [], versions: [], questions: [], pairs: [], candidates: [], fields: [], mask: seed.mask ?? [] };
  const uid = () => crypto.randomUUID();
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    data,
    maskTerms: async () => clone(data.mask),
    hasCandidateHashSince: async (hash, since) =>
      data.candidates.some((c) => c.content_hash === hash && new Date(c.created_at) >= since),
    insertCandidate: async (c) => {
      const row: CandidateRow = { ...clone(c), id: uid(), status: 'pending' };
      data.candidates.push(row);
      return clone(row);
    },
    listPendingCandidates: async () => clone(data.candidates.filter((c) => c.status === 'pending')),
    getCandidate: async (id) => clone(data.candidates.find((c) => c.id === id) ?? null),
    updateCandidate: async (id, patch) => { Object.assign(data.candidates.find((c) => c.id === id)!, clone(patch)); },
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
    insertPair: async (p) => { data.pairs.push(clone(p)); },
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
