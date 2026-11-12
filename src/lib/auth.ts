import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { API_PREFIX } from '@/lib/api'
import type { AppConfig } from '@/lib/config'

export function createAuth(database: Db, config: AppConfig) {
  const isProduction = config.NODE_ENV === 'production'

  return betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        enabled: true,
        trustedProviders: ['google', 'telegram-oidc'],
      },
    },
    advanced: {
      defaultCookieAttributes: {
        path: '/',
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction,
      },
      useSecureCookies: isProduction,
      ...(config.AUTH_COOKIE_DOMAIN
        ? {
            crossSubDomainCookies: {
              domain: config.AUTH_COOKIE_DOMAIN,
              enabled: true,
            },
          }
        : {}),
    },
    basePath: `${API_PREFIX}/auth`,
    baseURL: config.BETTER_AUTH_URL,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema,
    }),
    emailAndPassword: {
      autoSignIn: false,
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      autoSignInAfterVerification: true,
    },
    plugins: [admin()],
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.TRUSTED_ORIGINS,
    user: {
      additionalFields: {
        accountType: {
          input: false,
          required: false,
          type: 'string',
        },
        currency: {
          input: true,
          required: false,
          type: 'string',
        },
        fundMode: {
          input: false,
          required: false,
          type: 'string',
        },
        operatorExpiresAt: {
          input: false,
          required: false,
          type: 'date',
        },
        operatorNote: {
          input: false,
          required: false,
          type: 'string',
        },
        operatorOwner: {
          input: false,
          required: false,
          type: 'string',
        },
        referredBy: {
          input: true,
          required: false,
          type: 'string',
        },
        uid: {
          input: false,
          required: false,
          type: 'number',
        },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
