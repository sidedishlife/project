import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 : JS/CSS/스티커를 HTML 한 파일에 넣음 (claude.ai 아티팩트용, 비공개)
// --mode pages : GitHub Pages 공개 웹앱. 스티커 사진을 빼고 빌드 (사진은 각자 휴대폰에서 넣음)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  resolve: mode === 'pages'
    ? { alias: [{ find: /^\.\/sticker-assets$/, replacement: fileURLToPath(new URL('./src/sticker-assets-empty.ts', import.meta.url)) }] }
    : {},
  build: process.env.SINGLE ? { outDir: 'dist-single', copyPublicDir: false } : { outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
}));
