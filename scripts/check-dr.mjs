#!/usr/bin/env node
// Standalone Ahrefs Domain Rating (DR) refresh, meant to run from cron/CLI
// without the SvelteKit dev/build server. Duplicates the Ahrefs lookup logic
// from src/lib/server/ahrefs.ts since that module relies on SvelteKit's
// `$env/dynamic/private` alias, which isn't available outside Vite.
//
// Usage:
//   node scripts/check-dr.mjs            # refresh DR for every watched domain
//   node scripts/check-dr.mjs --missing  # only domains with no DR value yet
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const missingOnly = process.argv.includes('--missing');

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

if (!env.AHREFS_API_KEY) {
	console.error('AHREFS_API_KEY is not set; cannot check Domain Rating.');
	process.exit(1);
}

// --- ahrefs (mirrors src/lib/server/ahrefs.ts) ---

const AHREFS_API_BASE = 'https://api.ahrefs.com/v3';

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

async function lookupDomainAuthority(domain) {
	const url = new URL(`${AHREFS_API_BASE}/site-explorer/domain-rating`);
	url.searchParams.set('target', domain);
	url.searchParams.set('date', todayIso());
	url.searchParams.set('mode', 'subdomains');

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);

	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: {
				Authorization: `Bearer ${env.AHREFS_API_KEY}`,
				Accept: 'application/json'
			}
		});
		if (!res.ok) throw new Error(`Ahrefs API returned ${res.status}`);

		const data = await res.json();
		const rating = data.domain_rating?.domain_rating;
		return typeof rating === 'number' ? Math.round(rating) : null;
	} finally {
		clearTimeout(timeout);
	}
}

// --- main ---

const db = new Database(path.resolve(projectRoot, env.DATABASE_URL || 'local.db'));

const rows = db
	.prepare(
		`SELECT id, domain FROM watched_domain
		 WHERE is_excluded = 0 ${missingOnly ? 'AND domain_authority IS NULL' : ''}
		 ORDER BY domain`
	)
	.all();
const update = db.prepare('UPDATE watched_domain SET domain_authority = ? WHERE id = ?');

let checked = 0;
let updated = 0;
let errored = 0;

for (const row of rows) {
	checked++;
	try {
		const domainAuthority = await lookupDomainAuthority(row.domain);
		if (domainAuthority !== null) {
			update.run(domainAuthority, row.id);
			updated++;
		}
	} catch (err) {
		errored++;
		console.error(`Failed to check DR for ${row.domain}:`, err instanceof Error ? err.message : err);
	}

	await new Promise((r) => setTimeout(r, 300));
}

db.close();

console.log(
	`Checked ${checked} domain(s)${missingOnly ? ' missing DR' : ''}: ${updated} updated, ${errored} errored.`
);
