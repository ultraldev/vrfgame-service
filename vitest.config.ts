import path from 'node:path'

import { defineConfig } from 'vitest/config'

const sourceDir = path.resolve(import.meta.dirname, 'src')
const testDir = path.resolve(import.meta.dirname, 'test')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@test\//u, replacement: `${testDir}/` },
      { find: /^@\//u, replacement: `${sourceDir}/` },
    ],
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
})
