import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 : JS/CSS/스티커를 HTML 한 파일에 넣음 (claude.ai 아티팩트용, 비공개)
// --mode pages : GitHub Pages 공개 웹앱 (dist-pages)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  test: { include: ['src/**/*.test.ts'] },
  build: process.env.SINGLE ? { outDir: 'dist-single', copyPublicDir: false } : { outDir: mode === 'pages' ? 'dist-pages' : 'dist' },
}));
