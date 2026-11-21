// 말하기 채점: 들린 말(받아쓰기)과 정답 문장을 단어 단위로 비교
const CONTRACTIONS: Record<string, string> = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is', "it's": 'it is',
  "that's": 'that is', "there's": 'there is', "what's": 'what is', "let's": 'let us', "i'll": 'i will', "you'll": 'you will',
  "we'll": 'we will', "they'll": 'they will', "i've": 'i have', "you've": 'you have', "we've": 'we have', "i'd": 'i would',
  "you'd": 'you would', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not', "cannot": 'can not',
  "won't": 'will not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "shouldn't": 'should not',
  "wouldn't": 'would not', "couldn't": 'could not', "haven't": 'have not', "hasn't": 'has not', gonna: 'going to', wanna: 'want to',
};
const norm = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').trim();
/** 비교용 단어 목록 (축약형은 풀어서) */
const words = (s: string) => norm(s).split(/\s+/).filter(Boolean).flatMap((w) => (CONTRACTIONS[w] ?? w).split(' '));

export interface SpeakResult { score: number; heard: string; marks: { w: string; ok: boolean }[] }

/** 정답 문장의 각 단어가 말한 내용에 순서대로 들어 있는지 (가장 긴 공통 부분열) */
export function compare(target: string, heard: string): SpeakResult {
  // 정답은 화면에 보이는 단어 그대로 표시, 비교는 풀어 쓴 형태로
  const shown = target.split(/\s+/).filter(Boolean);
  const tw = shown.map((w) => words(w)); // 보이는 단어 하나가 비교 단어 여러 개일 수 있음 (I'll → i will)
  const flat = tw.flat();
  const hw = words(heard);
  const n = flat.length, m = hw.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = flat[i] === hw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array<boolean>(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (flat[i] === hw[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  let k = 0;
  const marks = shown.map((w, idx) => {
    const parts = tw[idx].length;
    const ok = parts === 0 || hit.slice(k, k + parts).every(Boolean);
    k += parts;
    return { w, ok };
  });
  const score = n ? Math.round((hit.filter(Boolean).length / n) * 100) : 0;
  return { score, heard, marks };
}

/** 첫 단어만 보여 주는 힌트: "Could ___ ___ ___?" */
export const hintOf = (en: string) => en.split(/\s+/).map((w, i) => (i === 0 ? w : w.replace(/[A-Za-z']/g, '_').replace(/_+/g, '___'))).join(' ');
