import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { searchKeyword, watchedDomain } from '$lib/server/db/schema';
import { DOMAIN_PATTERN, normalizeDomain } from '$lib/server/domain-utils';
import { searchDuckDuckGo } from '$lib/server/duckduckgo';
import { refreshDomain } from '$lib/server/domain-refresh';

export const load: PageServerLoad = async () => {
	const keywords = await db.query.searchKeyword.findMany({
		orderBy: asc(searchKeyword.createdAt)
	});
	return { keywords };
};

export const actions: Actions = {
	add: async ({ request }) => {
		const formData = await request.formData();
		const keyword = String(formData.get('keyword') ?? '').trim();

		if (!keyword) {
			return fail(400, { error: 'Enter a keyword' });
		}

		const existing = await db.query.searchKeyword.findFirst({
			where: eq(searchKeyword.keyword, keyword)
		});
		if (existing) {
			return fail(400, { error: `"${keyword}" is already in the list` });
		}

		await db.insert(searchKeyword).values({ keyword });
		return { success: true };
	},

	remove: async ({ request }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing keyword id' });

		await db.delete(searchKeyword).where(eq(searchKeyword.id, id));
		return { success: true };
	},

	search: async () => {
		const keywords = await db.query.searchKeyword.findMany();
		if (keywords.length === 0) {
			return fail(400, { error: 'Add at least one keyword first' });
		}

		const watched = await db.query.watchedDomain.findMany({
			columns: { domain: true, isExcluded: true }
		});
		const watchedStatus = new Map(
			watched.map((w) => [w.domain, w.isExcluded ? ('excluded' as const) : ('watching' as const)])
		);

		const settled = await Promise.allSettled(keywords.map((k) => searchDuckDuckGo(k.keyword)));

		const domainKeywords = new Map<string, Set<string>>();
		let failures = 0;

		settled.forEach((result, i) => {
			if (result.status === 'rejected') {
				failures++;
				return;
			}
			for (const domain of result.value) {
				if (!domainKeywords.has(domain)) domainKeywords.set(domain, new Set());
				domainKeywords.get(domain)!.add(keywords[i].keyword);
			}
		});

		if (failures === keywords.length) {
			return fail(500, { error: 'DuckDuckGo search failed for every keyword' });
		}

		const results = [...domainKeywords.entries()]
			.map(([domain, kws]) => ({
				domain,
				keywords: [...kws],
				status: watchedStatus.get(domain) ?? ('new' as const)
			}))
			.sort((a, b) => a.domain.localeCompare(b.domain));

		return {
			success: true,
			results,
			partial: failures > 0 ? failures : undefined
		};
	},

	addDomains: async ({ request }) => {
		const formData = await request.formData();
		const candidates = [
			...new Set(formData.getAll('domain').map((d) => normalizeDomain(String(d))))
		];
		const validDomains = candidates.filter((d) => DOMAIN_PATTERN.test(d));

		if (validDomains.length === 0) {
			return fail(400, { error: 'Select at least one domain to add' });
		}

		const added: string[] = [];
		for (const domain of validDomains) {
			const existing = await db.query.watchedDomain.findFirst({
				where: eq(watchedDomain.domain, domain)
			});
			if (existing) continue;

			const [row] = await db.insert(watchedDomain).values({ domain }).returning();
			added.push(domain);

			try {
				await refreshDomain(row.id, domain, { fetchDomainAuthority: true });
			} catch {
				// row is still created with pending status; can be refreshed from the domain list
			}
		}

		return { success: true, added };
	},

	excludeDomains: async ({ request }) => {
		const formData = await request.formData();
		const candidates = [
			...new Set(formData.getAll('domain').map((d) => normalizeDomain(String(d))))
		];
		const validDomains = candidates.filter((d) => DOMAIN_PATTERN.test(d));

		if (validDomains.length === 0) {
			return fail(400, { error: 'Select at least one domain to exclude' });
		}

		const excluded: string[] = [];
		for (const domain of validDomains) {
			const existing = await db.query.watchedDomain.findFirst({
				where: eq(watchedDomain.domain, domain)
			});
			if (existing) continue;

			// Excluded domains are never looked up (no whois, no site info, no DR),
			// so just record the domain without calling refreshDomain.
			await db.insert(watchedDomain).values({ domain, isExcluded: true });
			excluded.push(domain);
		}

		return { success: true, excluded };
	}
};
