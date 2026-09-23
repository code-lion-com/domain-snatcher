#!/usr/bin/env node
// Standalone Ahrefs backlinks/traffic refresh, meant to run from cron/CLI
// without the SvelteKit dev/build server. Duplicates the Ahrefs lookup logic
// from src/lib/server/ahrefs.ts since that module relies on SvelteKit's
// `$env/dynamic/private` alias, which isn't available outside Vite.
//
// Usage:
//   node scripts/check-metrics.mjs            # refresh for every watched domain
//   node scripts/check-metrics.mjs --missing  # only domains missing any of these fields
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
	console.error('AHREFS_API_KEY is not set; cannot check backlinks/traffic metrics.');
	process.exit(1);
}

// --- ahrefs (mirrors src/lib/server/ahrefs.ts) ---

const AHREFS_API_BASE = 'https://api.ahrefs.com/v3';

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

async function fetchAhrefs(path, domain) {
	const url = new URL(`${AHREFS_API_BASE}${path}`);
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

		return await res.json();
	} finally {
		clearTimeout(timeout);
	}
}

async function lookupBacklinksStats(domain) {
	const data = await fetchAhrefs('/site-explorer/backlinks-stats', domain);
	const { live, live_refdomains: liveRefdomains } = data.metrics ?? {};
	if (typeof live !== 'number' || typeof liveRefdomains !== 'number') return null;
	return { referringDomains: liveRefdomains, backlinks: live };
}

async function lookupOrganicTraffic(domain) {
	const data = await fetchAhrefs('/site-explorer/metrics', domain);
	const traffic = data.metrics?.org_traffic;
	return typeof traffic === 'number' ? Math.round(traffic) : null;
}

// --- main ---

const db = new Database(path.resolve(projectRoot, env.DATABASE_URL || 'local.db'));

const rows = db
	.prepare(
		`SELECT id, domain FROM watched_domain
		 WHERE is_excluded = 0 ${
				missingOnly
					? 'AND (referring_domains IS NULL OR backlinks IS NULL OR organic_traffic IS NULL)'
					: ''
			}
		 ORDER BY domain`
	)
	.all();
const update = db.prepare(
	'UPDATE watched_domain SET referring_domains = ?, backlinks = ?, organic_traffic = ? WHERE id = ?'
);

let checked = 0;
let updated = 0;
let errored = 0;

for (const row of rows) {
	checked++;
	try {
		const [backlinksStats, organicTraffic] = await Promise.all([
			lookupBacklinksStats(row.domain),
			lookupOrganicTraffic(row.domain)
		]);

		if (backlinksStats !== null || organicTraffic !== null) {
			const existing = db
				.prepare(
					'SELECT referring_domains, backlinks, organic_traffic FROM watched_domain WHERE id = ?'
				)
				.get(row.id);

			update.run(
				backlinksStats !== null ? backlinksStats.referringDomains : existing.referring_domains,
				backlinksStats !== null ? backlinksStats.backlinks : existing.backlinks,
				organicTraffic !== null ? organicTraffic : existing.organic_traffic,
				row.id
			);
			updated++;
		}
	} catch (err) {
		errored++;
		console.error(
			`Failed to check metrics for ${row.domain}:`,
			err instanceof Error ? err.message : err
		);
	}

	await new Promise((r) => setTimeout(r, 300));
}

db.close();

console.log(
	`Checked ${checked} domain(s)${missingOnly ? ' missing metrics' : ''}: ${updated} updated, ${errored} errored.`
);
