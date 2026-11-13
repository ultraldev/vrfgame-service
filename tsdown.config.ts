import { defineConfig } from 'tsdown'

import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: Object.keys(pkg.dependencies),
  },
  entry: ['src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  platform: 'node',
  sourcemap: true,
  target: 'node24',
  tsconfig: 'tsconfig.json',
})
