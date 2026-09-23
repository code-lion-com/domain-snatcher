import { env } from '$env/dynamic/private';

const API_BASE = 'https://api.ahrefs.com/v3';

interface DomainRatingResponse {
	domain_rating?: {
		domain_rating?: number;
	};
}

interface BacklinksStatsResponse {
	metrics?: {
		live?: number;
		live_refdomains?: number;
	};
}

interface MetricsResponse {
	metrics?: {
		org_traffic?: number;
	};
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

async function fetchAhrefs<T>(path: string, domain: string): Promise<T> {
	const url = new URL(`${API_BASE}${path}`);
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

		return (await res.json()) as T;
	} finally {
		clearTimeout(timeout);
	}
}

// Domain Authority isn't an Ahrefs metric (that's Moz's term) — Ahrefs' equivalent
// is Domain Rating (DR), which is what we store in the `domainAuthority` column.
export async function lookupDomainAuthority(domain: string): Promise<number | null> {
	if (!env.AHREFS_API_KEY) return null;

	const data = await fetchAhrefs<DomainRatingResponse>('/site-explorer/domain-rating', domain);
	const rating = data.domain_rating?.domain_rating;
	return typeof rating === 'number' ? Math.round(rating) : null;
}

export async function lookupBacklinksStats(
	domain: string
): Promise<{ referringDomains: number; backlinks: number } | null> {
	if (!env.AHREFS_API_KEY) return null;

	const data = await fetchAhrefs<BacklinksStatsResponse>('/site-explorer/backlinks-stats', domain);
	const { live, live_refdomains: liveRefdomains } = data.metrics ?? {};
	if (typeof live !== 'number' || typeof liveRefdomains !== 'number') return null;
	return { referringDomains: liveRefdomains, backlinks: live };
}

export async function lookupOrganicTraffic(domain: string): Promise<number | null> {
	if (!env.AHREFS_API_KEY) return null;

	const data = await fetchAhrefs<MetricsResponse>('/site-explorer/metrics', domain);
	const traffic = data.metrics?.org_traffic;
	return typeof traffic === 'number' ? Math.round(traffic) : null;
}
