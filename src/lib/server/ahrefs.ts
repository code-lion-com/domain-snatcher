import { env } from '$env/dynamic/private';

const API_BASE = 'https://api.ahrefs.com/v3';

interface DomainRatingResponse {
	domain_rating?: {
		domain_rating?: number;
	};
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

// Domain Authority isn't an Ahrefs metric (that's Moz's term) — Ahrefs' equivalent
// is Domain Rating (DR), which is what we store in the `domainAuthority` column.
export async function lookupDomainAuthority(domain: string): Promise<number | null> {
	if (!env.AHREFS_API_KEY) return null;

	const url = new URL(`${API_BASE}/site-explorer/domain-rating`);
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

		const data = (await res.json()) as DomainRatingResponse;
		const rating = data.domain_rating?.domain_rating;
		return typeof rating === 'number' ? Math.round(rating) : null;
	} finally {
		clearTimeout(timeout);
	}
}
