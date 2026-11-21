// 노트용 아주 작은 마크다운 → HTML. 먼저 전부 이스케이프하므로 노트의 HTML 은 절대 그대로 실리지 않는다.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 한 줄 안: `코드` 는 그대로 두고 나머지에서 **굵게** */
function inline(s: string): string {
  return s
    .split(/(`[^`]+`)/)
    .map((part) => (/^`[^`]+`$/.test(part) ? `<code>${part.slice(1, -1)}</code>` : part.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')))
    .join('');
}

export function renderMarkdown(src: string): string {
  const lines = esc(src.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list.length) out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = []; };

  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flushPara(); flushList(); }
    else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if (/^-{3,}\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); list.push(m[1]); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('');
}
