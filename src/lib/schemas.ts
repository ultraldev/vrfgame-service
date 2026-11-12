import * as z from 'zod'

export const Failure = z.object({
  code: z.string().optional(),
  error: z.string(),
  message: z.string(),
  statusCode: z.number().int(),
})

export const Health = z.object({
  status: z.literal('ok'),
})

export const Ready = z.object({
  checks: z.object({
    database: z.enum(['ok', 'error']),
    redis: z.enum(['ok', 'error']),
  }),
  status: z.enum(['ok', 'error']),
})

z.globalRegistry.add(Failure, { id: 'Failure' })
z.globalRegistry.add(Health, { id: 'HealthResponse' })
z.globalRegistry.add(Ready, { id: 'ReadinessResponse' })
