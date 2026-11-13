import { defineConfig } from 'oxlint'
import core from 'ultracite/oxlint/core'
import vitest from 'ultracite/oxlint/vitest'

export default defineConfig({
  env: core.env,
  extends: [core, vitest],
  ignorePatterns: [...(core.ignorePatterns || []), 'openapi.json'],
  rules: {
    'func-style': ['error', 'declaration'],
    'no-await-in-loop': 'allow',
    'oxc/no-barrel-file': 'allow',
    'prefer-destructuring': 'allow',
  },
})
