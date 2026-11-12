import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const userUidSequence = pgSequence('user_uid_seq', {
  increment: 1,
  startWith: 1,
})

export const user = pgTable(
  'user',
  {
    accountType: text('account_type').default('real').notNull(),
    banExpires: timestamp('ban_expires'),
    banReason: text('ban_reason'),
    banned: boolean('banned').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currency: text('currency'),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    fundMode: text('fund_mode').default('real').notNull(),
    id: text('id').primaryKey(),
    image: text('image'),
    name: text('name').notNull(),
    operatorExpiresAt: timestamp('operator_expires_at'),
    operatorNote: text('operator_note'),
    operatorOwner: text('operator_owner'),
    referredBy: text('referred_by'),
    role: text('role'),
    uid: integer('uid')
      .default(sql`nextval('user_uid_seq')`)
      .notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('user_uid_idx').on(table.uid),
    index('user_created_at_idx').on(table.createdAt),
  ],
)

export const session = pgTable(
  'session',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    id: text('id').primaryKey(),
    impersonatedBy: text('impersonated_by'),
    ipAddress: text('ip_address'),
    token: text('token').notNull().unique(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    accessToken: text('access_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    accountId: text('account_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    idToken: text('id_token'),
    password: text('password'),
    providerId: text('provider_id').notNull(),
    refreshToken: text('refresh_token'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    value: text('value').notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const passkey = pgTable(
  'passkey',
  {
    aaguid: text('aaguid'),
    backedUp: boolean('backed_up').notNull(),
    counter: integer('counter').notNull(),
    createdAt: timestamp('created_at'),
    credentialID: text('credential_id').notNull(),
    deviceType: text('device_type').notNull(),
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    transports: text('transports'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('passkey_userId_idx').on(table.userId),
    index('passkey_credentialID_idx').on(table.credentialID),
  ],
)

export const walletAddress = pgTable(
  'wallet_address',
  {
    address: text('address').notNull(),
    chainId: integer('chain_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    id: text('id').primaryKey(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('walletAddress_userId_idx').on(table.userId)],
)

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  passkeys: many(passkey),
  sessions: many(session),
  walletAddresses: many(walletAddress),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, {
    fields: [passkey.userId],
    references: [user.id],
  }),
}))

export const walletAddressRelations = relations(walletAddress, ({ one }) => ({
  user: one(user, {
    fields: [walletAddress.userId],
    references: [user.id],
  }),
}))
