import { DOMAIN_PATTERN } from '$lib/server/domain-utils';
import { registrableDomain } from '$lib/server/whois';

// The HTML-only endpoint (no JS) returns result links wrapped in a redirect
// like //duckduckgo.com/l/?uddg=<encoded-target-url>&rut=..., so the real
// destination is pulled out of the `uddg` query param rather than the href.
const RESULT_LINK_PATTERN = /uddg=([^&"]+)/g;

function extractRegistrableDomain(encodedUrl: string): string | null {
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

export async function searchDuckDuckGo(keyword: string, limit = 20): Promise<string[]> {
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

		const domains = new Set<string>();
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
