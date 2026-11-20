// dist-single/index.html → artifact/malhae.html (claude.ai 아티팩트 본문 형식: title/style/본문/script)
import fs from 'node:fs';
const html = fs.readFileSync('dist-single/index.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
const safe = (s) => s.replace(/\uFFFD/g, '\\uFFFD');
const out = `<title>말해영어</title>
<meta name="claude:viewport-fit-sides" content="cover">
${styles}
<div id="app"></div>
${safe(scripts)}
`;
fs.mkdirSync('artifact', { recursive: true });
fs.writeFileSync('artifact/malhae.html', out);
console.log('artifact/malhae.html', (out.length / 1024).toFixed(0) + 'KB');
