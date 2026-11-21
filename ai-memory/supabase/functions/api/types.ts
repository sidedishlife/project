// 서버 공용 타입
export type CandidateInput = {
  title: string;
  note_md: string;
  questions: { kind: 'explain' | 'apply' | 'compare'; prompt: string }[];
  field_hint?: string;
};
