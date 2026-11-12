import type { FastifyInstance } from 'fastify'
import type { OpenAPIV3 } from 'openapi-types'

export function openapi(app: FastifyInstance) {
  const document = app.swagger() as OpenAPIV3.Document
  const schemas = document.components?.schemas ?? {}
  const reachable = new Set<string>()

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item)
      }
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }

    const record = value as Record<string, unknown>
    const ref = record.$ref
    if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
      const name = ref.slice('#/components/schemas/'.length)
      if (!reachable.has(name)) {
        reachable.add(name)
        visit(schemas[name])
      }
    }

    for (const nested of Object.values(record)) {
      visit(nested)
    }
  }

  visit(document.paths)
  if (document.components) {
    document.components.schemas = Object.fromEntries(
      Object.entries(schemas).filter(([name]) => reachable.has(name)),
    )
  }
  return document
}
