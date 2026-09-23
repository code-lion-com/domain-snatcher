import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

// Singleton key/value settings, e.g. when the cron whois sweep last ran.
export const appSetting = sqliteTable('app_setting', {
	key: text('key').primaryKey(),
	value: text('value')
});

export const watchedDomain = sqliteTable('watched_domain', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	domain: text('domain').notNull().unique(),
	expirationDate: integer('expiration_date', { mode: 'timestamp_ms' }),
	registrar: text('registrar'),
	domainAuthority: integer('domain_authority'),
	title: text('title'),
	faviconUrl: text('favicon_url'),
	lookupStatus: text('lookup_status').notNull().default('pending'),
	lookupError: text('lookup_error'),
	lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
	isExcluded: integer('is_excluded', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull()
});

export const searchKeyword = sqliteTable('search_keyword', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	keyword: text('keyword').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull()
});

export * from './auth.schema';
