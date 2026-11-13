export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function findErrorCode(error: unknown) {
  let current = error
  const visited = new Set<unknown>()
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current)
    if ('code' in current && typeof current.code === 'string') {
      return current.code
    }
    current = 'cause' in current ? current.cause : null
  }
  return null
}
