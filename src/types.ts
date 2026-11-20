export interface Word {
  word: string; // 문장에 나온 형태
  lemma: string; // 기본형
  pos: string; // 품사 (한국어)
  ipa: string; // 발음기호
  meaning_ko: string; // 뜻
  example_en: string; // 예문
}

export interface Card {
  id: string;
  ko: string; // 사용자가 표현하고 싶었던 한국어
  en: string; // 대표 영어 표현
  alts: string[]; // 다른 표현
  note: string; // 뉘앙스/상황 설명(한국어)
  words: Word[];
  createdAt: number;
  // 망각곡선(간격 반복) 상태
  stage: number; // 0 = 새로 배움, 높을수록 오래 기억
  due: number; // 다음 복습 시각(ms)
  listens: number; // 누적 듣기 횟수
  reviews: number;
  lapses: number; // 잊어버린 횟수
}

export interface Stats {
  xp: number;
  streak: number;
  lastStudyDay: string; // YYYY-MM-DD
  bestCombo: number;
}

export interface Settings {
  apiKey: string;
  rate: number; // TTS 속도
  listenTarget: number; // 기본 20회
}
