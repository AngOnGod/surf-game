import { rmSync } from 'node:fs';
import { defineConfig } from 'vite';

// public/maps: third-party maps whose licence allows sharing them unmodified with credit (CREDITS.md), shipped.
// public/bsp: maps for personal use only, served by the dev server and dropped from every build.
export default defineConfig({
  base: './', // relative asset paths: the build works from any sub-path (e.g. a GitHub Pages project site)
  plugins: [{ name: 'personal-maps', closeBundle: () => rmSync('dist/bsp', { recursive: true, force: true }) }],
});
