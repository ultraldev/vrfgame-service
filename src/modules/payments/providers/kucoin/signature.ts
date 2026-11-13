import { createSign, createVerify } from 'node:crypto'

export function normalizePem(value: string) {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value
}

function normalizeSigningValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  throw new TypeError(`Unsupported KuCoin Pay signing value: ${typeof value}`)
}

export function buildSignatureString(input: {
  apiKey: string
  fieldOrder: readonly string[]
  fields: Record<string, unknown>
  timestamp: string
}) {
  const values: Record<string, unknown> = {
    ...input.fields,
    apiKey: input.apiKey,
    timestamp: input.timestamp,
  }

  return input.fieldOrder
    .map((key) => {
      const value = normalizeSigningValue(values[key])
      return value === null ? null : `${key}=${value}`
    })
    .filter((pair): pair is string => pair !== null)
    .join('&')
}

export function signRequest(signingString: string, privateKey: string) {
  return createSign('RSA-SHA256')
    .update(signingString, 'utf-8')
    .sign(normalizePem(privateKey), 'base64')
}

export function verifySignature(input: {
  publicKey: string
  signature: string
  signingString: string
}) {
  return createVerify('RSA-SHA256')
    .update(input.signingString, 'utf-8')
    .verify(normalizePem(input.publicKey), input.signature, 'base64')
}
