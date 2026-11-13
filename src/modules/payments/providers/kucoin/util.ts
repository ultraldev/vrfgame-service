import { isRecord } from '@/lib/object'

import { KuCoinPayRequestError } from './errors'
import type { KuCoinPayFailureClass } from './errors'

export function stringField(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value)
    }
  }
  return ''
}

export function optionalString(value: string) {
  return value.length > 0 ? value : undefined
}

export function arrayOfRecords(
  payload: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) {
      return value.filter(isRecord)
    }
  }
  return null
}

export function numberField(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return null
}

export function requiredOption(value: string | undefined, key: string) {
  const normalized = value?.trim()
  if (!normalized) {
    throw new KuCoinPayRequestError(`Missing ${key}`, 'rejected')
  }
  return normalized
}

export function businessFailureClass(payload: unknown): KuCoinPayFailureClass {
  if (!isRecord(payload)) {
    return 'server'
  }
  if (payload.retry === true) {
    return 'throttled'
  }
  const code = stringField(payload, ['code'])
  if (code === '480005') {
    return 'throttled'
  }
  if (code === '480006' || code === '480016' || code === '480000') {
    return 'server'
  }
  return 'rejected'
}

export function failureClassForResponse(
  status: number,
  payload: unknown,
): KuCoinPayFailureClass {
  if (status === 429) {
    return 'throttled'
  }
  if (status >= 500) {
    return 'server'
  }
  if (status >= 400) {
    return 'rejected'
  }
  return businessFailureClass(payload)
}
