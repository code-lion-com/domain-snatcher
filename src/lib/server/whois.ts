import { execFile } from 'node:child_process';

// The default `whois` binary resolves these TLDs via an IANA referral hop
// that is slow/rate-limited and times out under any concurrency. Querying
// the registry's whois server directly is fast and reliable.
const TLD_SERVERS: Record<string, string> = {
	ca: 'whois.cira.ca'
};

function serverFor(domain: string): string | null {
	const tld = domain.split('.').at(-1);
	return tld ? (TLD_SERVERS[tld] ?? null) : null;
}

// CIRA registers most .ca domains directly under the TLD (example.ca), but
// provincial/territorial and government namespaces are second-level suffixes
// where the registrant holds the third label instead (example.qc.ca).
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

// The name a registry actually has a record for. For most TLDs that's the
// last two labels; a few ccTLD namespaces register one level deeper.
// Anything below that depth (e.g. a client site hosted at
// `client.agency.ca`) is a subdomain, not a separately registrable name, so
// whois for it should reflect the parent's registration instead of
// reporting a false "no match".
export function registrableDomain(domain: string): string {
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

function runWhois(domain: string): Promise<string> {
	const server = serverFor(domain);
	const args = server ? ['-h', server, domain] : [domain];

	return new Promise((resolve, reject) => {
		execFile('whois', args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
			// whois exits non-zero on some registries even with usable output; only bail if we got nothing
			if (error && !stdout) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

function parseField(raw: string, keys: string[]): string | null {
	const lines = raw.split(/\r?\n/);
	for (const line of lines) {
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

export interface WhoisResult {
	available: boolean;
	expirationDate: Date | null;
	registrar: string | null;
	raw: string;
}

export async function lookupWhois(domain: string): Promise<WhoisResult> {
	const raw = await runWhois(registrableDomain(domain));

	if (/no match for|not found|no entries found|domain not found|status:\s*free/i.test(raw)) {
		return { available: true, expirationDate: null, registrar: null, raw };
	}

	const expiryRaw = parseField(raw, EXPIRY_KEYS);
	const registrar = parseField(raw, REGISTRAR_KEYS);
	const expirationDate = expiryRaw ? new Date(expiryRaw) : null;

	return {
		available: false,
		expirationDate: expirationDate && !isNaN(expirationDate.getTime()) ? expirationDate : null,
		registrar,
		raw
	};
}
