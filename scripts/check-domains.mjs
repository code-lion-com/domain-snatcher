#!/usr/bin/env node
// Standalone whois check + availability email, meant to run from cron without
// the SvelteKit dev/build server. Duplicates the whois/email logic from
// src/lib/server/{whois,brevo}.ts since those modules rely on SvelteKit's
// `$env/dynamic/private` alias, which isn't available outside Vite.
import { execFile } from 'node:child_process';
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

// --- whois (mirrors src/lib/server/whois.ts) ---

const TLD_SERVERS = { ca: 'whois.cira.ca' };

function serverFor(domain) {
	const tld = domain.split('.').at(-1);
	return tld ? (TLD_SERVERS[tld] ?? null) : null;
}

const CA_SECOND_LEVEL = new Set([
	'ab.ca',
	'bc.ca',
	'mb.ca',
	'nb.ca',
	'nf.ca',
	'nl.ca',
	'ns.ca',
	'nt.ca',
	'nu.ca',
	'on.ca',
	'pe.ca',
	'qc.ca',
	'sk.ca',
	'yk.ca',
	'gc.ca'
]);

function registrableDomain(domain) {
	const labels = domain.split('.');
	if (labels.length <= 2) return domain;
	const lastTwo = labels.slice(-2).join('.');
	const depth = CA_SECOND_LEVEL.has(lastTwo) ? 3 : 2;
	return labels.slice(-depth).join('.');
}

const EXPIRY_KEYS = [
	'registry expiry date',
	'registrar registration expiration date',
	'expiration date',
	'expiration time',
	'expiry date',
	'paid-till',
	'renewal date'
];

const REGISTRAR_KEYS = ['registrar', 'sponsoring registrar'];

function runWhois(domain) {
	const server = serverFor(domain);
	const args = server ? ['-h', server, domain] : [domain];

	return new Promise((resolve, reject) => {
		execFile('whois', args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
			if (error && !stdout) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

function parseField(raw, keys) {
	for (const line of raw.split(/\r?\n/)) {
		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) continue;
		const key = line.slice(0, colonIndex).trim().toLowerCase();
		if (keys.includes(key)) {
			const value = line.slice(colonIndex + 1).trim();
			if (value) return value;
		}
	}
	return null;
}

async function lookupWhois(domain) {
	const raw = await runWhois(registrableDomain(domain));

	if (/no match for|not found|no entries found|domain not found|status:\s*free/i.test(raw)) {
		return { available: true, expirationDate: null, registrar: null };
	}

	const expiryRaw = parseField(raw, EXPIRY_KEYS);
	const registrar = parseField(raw, REGISTRAR_KEYS);
	const expirationDate = expiryRaw ? new Date(expiryRaw) : null;

	return {
		available: false,
		expirationDate: expirationDate && !isNaN(expirationDate.getTime()) ? expirationDate : null,
		registrar
	};
}

// --- brevo (mirrors src/lib/server/brevo.ts) ---

function formatDate(ms) {
	if (!ms) return null;
	return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function sendDomainAvailableEmail(domain, { title, expirationDateMs, domainAuthority }) {
	if (!env.BREVO_API_KEY || !env.BREVO_NOTIFY_EMAIL || !env.BREVO_SENDER_EMAIL) return;

	const details = [];
	if (title) details.push(`<li><strong>Title:</strong> ${title}</li>`);
	const expired = formatDate(expirationDateMs);
	if (expired) details.push(`<li><strong>Last expiration date:</strong> ${expired}</li>`);
	if (domainAuthority !== null && domainAuthority !== undefined) {
		details.push(`<li><strong>Domain Rating (Ahrefs):</strong> ${domainAuthority}</li>`);
	}

	const res = await fetch('https://api.brevo.com/v3/smtp/email', {
		method: 'POST',
		headers: {
			'api-key': env.BREVO_API_KEY,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			sender: { email: env.BREVO_SENDER_EMAIL, name: 'Equinoxe Domain Snatcher' },
			to: [{ email: env.BREVO_NOTIFY_EMAIL }],
			subject: `${domain} is available!`,
			htmlContent: `<p><strong>${domain}</strong> is now available to register.</p>${details.length ? `<ul>${details.join('')}</ul>` : ''}<p><a href="https://www.google.com/search?q=register+${encodeURIComponent(domain)}">Grab it before someone else does.</a></p>`
		})
	});

	if (!res.ok) {
		throw new Error(`Brevo API returned ${res.status}: ${await res.text()}`);
	}
}

// --- main ---

const db = new Database(path.resolve(projectRoot, env.DATABASE_URL || 'local.db'));
const rows = db
	.prepare(
		'SELECT id, domain, lookup_status, title, domain_authority, expiration_date FROM watched_domain ORDER BY domain'
	)
	.all();
const update = db.prepare(
	'UPDATE watched_domain SET expiration_date = ?, registrar = ?, lookup_status = ?, lookup_error = ?, last_checked_at = ? WHERE id = ?'
);

let checked = 0;
let becameAvailable = 0;
let errored = 0;

for (const row of rows) {
	checked++;
	let whois = null;
	let lookupStatus = 'ok';
	let lookupError = null;

	try {
		whois = await lookupWhois(row.domain);
		lookupStatus = whois.available ? 'available' : 'ok';
	} catch (err) {
		lookupStatus = 'error';
		lookupError = err instanceof Error ? err.message : String(err);
		errored++;
	}

	update.run(
		whois?.expirationDate ? whois.expirationDate.getTime() : null,
		whois?.registrar ?? null,
		lookupStatus,
		lookupError,
		Date.now(),
		row.id
	);

	if (lookupStatus === 'available' && row.lookup_status !== 'available') {
		becameAvailable++;
		try {
			await sendDomainAvailableEmail(row.domain, {
				title: row.title,
				expirationDateMs: row.expiration_date,
				domainAuthority: row.domain_authority
			});
			console.log(`Notified: ${row.domain} is now available`);
		} catch (err) {
			console.error(`Failed to send availability email for ${row.domain}:`, err);
		}
	}

	await new Promise((r) => setTimeout(r, 300));
}

db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
	'last_whois_check_at',
	String(Date.now())
);

db.close();

console.log(`Checked ${checked} domain(s): ${becameAvailable} newly available, ${errored} errored.`);
