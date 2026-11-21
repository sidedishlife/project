export interface MaskTerm { term: string; alias: string }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 긴 항목부터 하나의 교대 정규식으로 한 번에 치환해, "A사업부"가 "A사"보다 먼저 잡히고
// 이미 치환된 결과가 다시 치환되지 않도록 한다.
export function applyMask(text: string, terms: MaskTerm[]): string {
  const map = new Map<string, string>();
  for (const { term, alias } of terms) {
    if (term && !map.has(term)) map.set(term, alias);
  }
  if (map.size === 0) return text;
  const sorted = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(sorted.map(escapeRegExp).join('|'), 'g');
  return text.replace(re, (m) => map.get(m) ?? m);
}
