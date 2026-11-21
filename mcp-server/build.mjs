// build.mjs — gera dist/cli.js com Node puro (sem Bun, sem chmod): funciona em Windows, Mac e Linux.
import { build } from 'esbuild'

await build({
  entryPoints: ['cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  packages: 'external', // as dependências do package.json são instaladas pelo npm
  logLevel: 'info',
})
