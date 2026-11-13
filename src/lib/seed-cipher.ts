import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { AppConfig } from '@/lib/config'

const V2_PREFIX = 'enc:v2'

interface SeedCipher {
  decrypt: (value: string) => string
  encrypt: (seed: string) => string
}

const cipherCache = new WeakMap<AppConfig, SeedCipher>()

function parseKey(value: string, id: string) {
  const key = Buffer.from(value, 'hex')
  if (key.length !== 32) {
    throw new Error(`Seed encryption key ${id} must be 32 bytes encoded as hex`)
  }
  return key
}

function parseKeyring(config: AppConfig) {
  if (!config.SEED_ENCRYPTION_KEYS) {
    return new Map<string, Buffer>()
  }

  let value: unknown
  try {
    value = JSON.parse(config.SEED_ENCRYPTION_KEYS)
  } catch (error) {
    throw new Error('SEED_ENCRYPTION_KEYS must be a JSON object', {
      cause: error,
    })
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SEED_ENCRYPTION_KEYS must be a JSON object')
  }

  return new Map(
    Object.entries(value).map(([id, key]) => {
      if (!id || id.includes(':') || typeof key !== 'string') {
        throw new Error('SEED_ENCRYPTION_KEYS contains an invalid key entry')
      }
      return [id, parseKey(key, id)]
    }),
  )
}

function createCipher(config: AppConfig): SeedCipher {
  const keyring = parseKeyring(config)
  const activeId = config.SEED_ENCRYPTION_ACTIVE_KEY_ID

  if (!activeId) {
    if (config.NODE_ENV === 'development' || config.NODE_ENV === 'test') {
      return {
        decrypt: (value) => value,
        encrypt: (seed) => seed,
      }
    }

    throw new Error('Seed encryption key configuration is required')
  }

  const activeKey = keyring.get(activeId)
  if (!activeKey) {
    throw new Error(`Active seed encryption key not found: ${activeId}`)
  }

  return {
    decrypt(value) {
      if (!value.startsWith(`${V2_PREFIX}:`)) {
        return value
      }

      const [keyId, ivHex, tagHex, encryptedHex] = value.split(':').slice(2)
      const key = keyring.get(keyId)
      if (!key) {
        throw new Error(`Seed encryption key not found: ${keyId}`)
      }

      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivHex, 'hex'),
      )
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
      return Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
      ]).toString('utf-8')
    },
    encrypt(seed) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', activeKey, iv)
      const encrypted = Buffer.concat([
        cipher.update(seed, 'utf-8'),
        cipher.final(),
      ])
      const tag = cipher.getAuthTag()
      return [
        V2_PREFIX,
        activeId,
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted.toString('hex'),
      ].join(':')
    },
  }
}

function seedCipher(config: AppConfig) {
  const cached = cipherCache.get(config)
  if (cached) {
    return cached
  }

  const cipher = createCipher(config)
  cipherCache.set(config, cipher)
  return cipher
}

export function encryptSeed(seed: string, config: AppConfig) {
  return seedCipher(config).encrypt(seed)
}

export function decryptSeed(value: string, config: AppConfig) {
  return seedCipher(config).decrypt(value)
}
