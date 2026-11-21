import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './md';

describe('renderMarkdown', () => {
  it('<script> 태그를 이스케이프한다 (XSS 방지)', () => {
    const html = renderMarkdown('안녕 <script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('속성 주입·이미지 태그도 이스케이프한다', () => {
    const html = renderMarkdown('**<img src=x onerror=alert(1)>**');
    expect(html).not.toContain('<img');
    expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
  });
  it('제목·굵게·코드·목록·구분선·문단', () => {
    const html = renderMarkdown('# 큰\n## 중\n### 작\n\n문단 **굵게** 와 `코드`\n\n- 하나\n- 둘\n\n---\n\n끝');
    expect(html).toContain('<h1>큰</h1>');
    expect(html).toContain('<h2>중</h2>');
    expect(html).toContain('<h3>작</h3>');
    expect(html).toContain('<p>문단 <strong>굵게</strong> 와 <code>코드</code></p>');
    expect(html).toContain('<ul><li>하나</li><li>둘</li></ul>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<p>끝</p>');
  });
  it('코드 안의 별표는 굵게로 바뀌지 않는다', () => {
    expect(renderMarkdown('`a **b** c`')).toBe('<p><code>a **b** c</code></p>');
  });
  it('빈 입력은 빈 문자열', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
