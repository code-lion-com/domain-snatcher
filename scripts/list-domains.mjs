#!/usr/bin/env node
// Prints watched domains with days left until expiration and Domain Rating,
// meant to run from cron/CLI without the SvelteKit dev/build server.
//
// Usage:
//   node scripts/list-domains.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnv(filePath) {
	const env = {};
	let content;
	try {
		content = readFileSync(filePath, 'utf8');
	} catch {
		return env;
	}
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, '');
		env[key] = value;
	}
	return env;
}

const env = loadEnv(path.join(projectRoot, '.env'));

function daysLeft(expirationDateMs) {
	if (!expirationDateMs) return null;
	return Math.ceil((expirationDateMs - Date.now()) / (24 * 60 * 60 * 1000));
}

const db = new Database(path.resolve(projectRoot, env.DATABASE_URL || 'local.db'));

const rows = db
	.prepare(
		`SELECT domain, expiration_date, domain_authority, lookup_status FROM watched_domain
		 WHERE is_excluded = 0
		 ORDER BY
		   CASE
		     WHEN lookup_status = 'available' THEN 0
		     WHEN expiration_date IS NOT NULL THEN 1
		     ELSE 2
		   END,
		   expiration_date ASC`
	)
	.all();

db.close();

console.table(
	rows.map((row) => ({
		domain: row.domain,
		'days left':
			row.lookup_status === 'available' ? 'available now!' : (daysLeft(row.expiration_date) ?? '—'),
		DR: row.domain_authority ?? '—'
	}))
);
