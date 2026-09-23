#!/usr/bin/env node
// Standalone whois check + availability email, meant to run from cron without
// the SvelteKit dev/build server. Duplicates the whois/email logic from
// src/lib/server/{whois,brevo}.ts since those modules rely on SvelteKit's
// `$env/dynamic/private` alias, which isn't available outside Vite.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

// Some registries (e.g. Identity Digital's .care) have retired port-43 whois
// in favor of RDAP-only, so the classic `whois` binary only ever gets back
// the IANA referral stub for those TLDs, with no registrar/expiry fields.
// This mirrors the referral IANA whois itself would normally follow, but
// over RDAP: look up the registry's RDAP base URL from IANA's bootstrap
// registry, then query it directly for the domain.
let rdapBootstrap = null;

function loadRdapBootstrap() {
	if (!rdapBootstrap) {
		rdapBootstrap = fetch('https://data.iana.org/rdap/dns.json', {
			signal: AbortSignal.timeout(10_000)
		})
			.then((res) => res.json())
			.then((data) => {
				const map = new Map();
				for (const [tlds, urls] of data.services) {
					for (const tld of tlds) map.set(tld, urls[0]);
				}
				return map;
			})
			.catch((error) => {
				rdapBootstrap = null;
				throw error;
			});
	}
	return rdapBootstrap;
}

function extractVcardField(vcardArray, field) {
	if (!Array.isArray(vcardArray) || vcardArray[0] !== 'vcard' || !Array.isArray(vcardArray[1])) {
		return null;
	}
	for (const entry of vcardArray[1]) {
		if (Array.isArray(entry) && entry[0] === field && typeof entry[3] === 'string' && entry[3]) {
			return entry[3];
		}
	}
	return null;
}

async function lookupRdap(domain) {
	const tld = domain.split('.').at(-1);
	if (!tld) return null;

	const base = (await loadRdapBootstrap()).get(tld);
	if (!base) return null;

	const res = await fetch(`${base.replace(/\/$/, '')}/domain/${domain}`, {
		signal: AbortSignal.timeout(15_000)
	});

	if (res.status === 404) {
		return { available: true, expirationDate: null, registrar: null };
	}
	if (!res.ok) return null;

	const data = await res.json();

	const expiryEvent = data.events?.find((event) => event.eventAction === 'expiration');
	const registrarEntity = data.entities?.find((entity) => entity.roles?.includes('registrar'));
	const registrar = registrarEntity ? extractVcardField(registrarEntity.vcardArray, 'fn') : null;
	const expirationDate = expiryEvent ? new Date(expiryEvent.eventDate) : null;

	return {
		available: false,
		expirationDate: expirationDate && !isNaN(expirationDate.getTime()) ? expirationDate : null,
		registrar
	};
}

async function lookupWhois(domain) {
	const registrable = registrableDomain(domain);
	const raw = await runWhois(registrable);

	if (/no match for|not found|no entries found|domain not found|status:\s*free/i.test(raw)) {
		return { available: true, expirationDate: null, registrar: null };
	}

	const expiryRaw = parseField(raw, EXPIRY_KEYS);
	const registrar = parseField(raw, REGISTRAR_KEYS);

	if (!expiryRaw && !registrar) {
		const rdapResult = await lookupRdap(registrable).catch(() => null);
		if (rdapResult) return rdapResult;
	}

	const expirationDate = expiryRaw ? new Date(expiryRaw) : null;

	return {
		available: false,
		expirationDate: expirationDate && !isNaN(expirationDate.getTime()) ? expirationDate : null,
		registrar
	};
}

// --- duckduckgo (mirrors src/lib/server/duckduckgo.ts) ---

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// The HTML-only endpoint (no JS) returns result links wrapped in a redirect
// like //duckduckgo.com/l/?uddg=<encoded-target-url>&rut=..., so the real
// destination is pulled out of the `uddg` query param rather than the href.
const RESULT_LINK_PATTERN = /uddg=([^&"]+)/g;

function extractRegistrableDomain(encodedUrl) {
	try {
		const hostname = new URL(decodeURIComponent(encodedUrl)).hostname
			.toLowerCase()
			.replace(/^www\./, '');
		if (!DOMAIN_PATTERN.test(hostname)) return null;
		return registrableDomain(hostname);
	} catch {
		return null;
	}
}

async function searchDuckDuckGo(keyword, limit = 20) {
	const url = new URL('https://html.duckduckgo.com/html/');
	url.searchParams.set('q', keyword);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);

	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: {
				'user-agent': 'Mozilla/5.0 (compatible; domain-snatcher/1.0)',
				accept: 'text/html'
			}
		});
		if (!res.ok) throw new Error(`DuckDuckGo search returned ${res.status}`);
		const html = await res.text();

		const domains = new Set();
		for (const match of html.matchAll(RESULT_LINK_PATTERN)) {
			const domain = extractRegistrableDomain(match[1]);
			if (domain) domains.add(domain);
			if (domains.size >= limit) break;
		}
		return [...domains];
	} finally {
		clearTimeout(timeout);
	}
}

// --- site info (mirrors src/lib/server/site-info.ts) ---

async function fetchHtml(domain) {
	for (const url of [`https://${domain}`, `http://${domain}`]) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 8_000);
			const res = await fetch(url, {
				signal: controller.signal,
				redirect: 'follow',
				headers: { 'user-agent': 'Mozilla/5.0 (compatible; domain-snatcher/1.0)' }
			});
			clearTimeout(timeout);
			if (res.ok) return await res.text();
		} catch {
			// try next scheme
		}
	}
	return null;
}

async function lookupSiteInfo(domain) {
	const html = await fetchHtml(domain);
	const titleMatch = html?.match(/<title[^>]*>([^<]*)<\/title>/i);
	const title = titleMatch ? titleMatch[1].trim().slice(0, 200) || null : null;

	return {
		title,
		faviconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
	};
}

// --- ahrefs (mirrors src/lib/server/ahrefs.ts) ---

const AHREFS_API_BASE = 'https://api.ahrefs.com/v3';

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

async function lookupDomainAuthority(domain) {
	if (!env.AHREFS_API_KEY) return null;

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

// --- brevo (mirrors src/lib/server/brevo.ts) ---

function formatDate(ms) {
	if (!ms) return null;
	return new Date(ms).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
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

// --- discover new domains from search keywords ---

const keywords = db.prepare('SELECT keyword FROM search_keyword').all();
let discovered = 0;

if (keywords.length > 0) {
	const existingDomains = new Set(
		db
			.prepare('SELECT domain FROM watched_domain')
			.all()
			.map((r) => r.domain)
	);

	const settled = await Promise.allSettled(keywords.map((k) => searchDuckDuckGo(k.keyword)));
	const found = new Set();
	for (const result of settled) {
		if (result.status === 'fulfilled') {
			for (const domain of result.value) found.add(domain);
		}
	}

	const insert = db.prepare(
		'INSERT INTO watched_domain (id, domain, title, favicon_url, domain_authority) VALUES (?, ?, ?, ?, ?)'
	);

	for (const domain of found) {
		if (existingDomains.has(domain)) continue;
		existingDomains.add(domain);

		const [siteInfo, domainAuthority] = await Promise.all([
			lookupSiteInfo(domain).catch(() => null),
			lookupDomainAuthority(domain).catch(() => null)
		]);

		insert.run(
			randomUUID(),
			domain,
			siteInfo?.title ?? null,
			siteInfo?.faviconUrl ?? `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
			domainAuthority
		);
		discovered++;
	}

	if (discovered > 0) console.log(`Discovered ${discovered} new domain(s) from keyword search.`);
}

const rows = db
	.prepare(
		'SELECT id, domain, lookup_status, title, domain_authority, expiration_date FROM watched_domain WHERE is_excluded = 0 ORDER BY domain'
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

db.prepare(
	'INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
).run('last_whois_check_at', String(Date.now()));

db.close();

console.log(
	`Discovered ${discovered} new domain(s). Checked ${checked} domain(s): ${becameAvailable} newly available, ${errored} errored.`
);
