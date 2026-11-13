import { createSign, createVerify } from 'node:crypto'

function toPem(key: string, type: 'PRIVATE' | 'PUBLIC') {
  const clean = key
    .replaceAll(/-----BEGIN [A-Z ]+ KEY-----/gu, '')
    .replaceAll(/-----END [A-Z ]+ KEY-----/gu, '')
    .replaceAll(/\s+/gu, '')
  const body = clean.match(/.{1,64}/gu)?.join('\n') ?? clean
  return `-----BEGIN ${type} KEY-----\n${body}\n-----END ${type} KEY-----`
}

export function signRsaSha256(jsonBody: string, privateKey: string) {
  const sign = createSign('RSA-SHA256')
  sign.update(jsonBody, 'utf-8')
  sign.end()
  return sign.sign(toPem(privateKey, 'PRIVATE'), 'base64')
}

export function verifyRsaSha256(
  jsonBody: string,
  signature: string,
  publicKey: string,
) {
  const verify = createVerify('RSA-SHA256')
  verify.update(jsonBody, 'utf-8')
  verify.end()
  return verify.verify(toPem(publicKey, 'PUBLIC'), signature, 'base64')
}
