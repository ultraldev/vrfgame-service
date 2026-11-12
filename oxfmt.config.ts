import { defineConfig } from 'oxfmt'
import ultracite from 'ultracite/oxfmt'

export default defineConfig({
  ...ultracite,
  arrowParens: 'always',
  ignorePatterns: ['openapi.json'],
  printWidth: 80,
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
})
