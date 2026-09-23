import { fail } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { appSetting, watchedDomain } from '$lib/server/db/schema';
import { refreshDomain } from '$lib/server/domain-refresh';
import { DOMAIN_PATTERN, normalizeDomain } from '$lib/server/domain-utils';

export const load: PageServerLoad = async () => {
	const domains = await db.query.watchedDomain.findMany({
		where: eq(watchedDomain.isExcluded, false),
		// Sort by days left ascending (soonest-expiring first). Domains already
		// available now are the most urgent despite having no expiration date;
		// domains with no lookup data yet (pending/error) sort last.
		orderBy: [
			sql`case
				when ${watchedDomain.lookupStatus} = 'available' then 0
				when ${watchedDomain.expirationDate} is not null then 1
				else 2
			end`,
			asc(watchedDomain.expirationDate)
		]
	});
	const lastWhoisCheck = await db.query.appSetting.findFirst({
		where: eq(appSetting.key, 'last_whois_check_at')
	});
	const lastWhoisCheckAt = lastWhoisCheck?.value ? Number(lastWhoisCheck.value) : null;
	return { domains, lastWhoisCheckAt };
};

export const actions: Actions = {
	add: async ({ request }) => {
		const formData = await request.formData();
		const domain = normalizeDomain(String(formData.get('domain') ?? ''));

		if (!domain || !DOMAIN_PATTERN.test(domain)) {
			return fail(400, { error: 'Enter a valid domain name, e.g. example.com' });
		}

		const existing = await db.query.watchedDomain.findFirst({
			where: eq(watchedDomain.domain, domain)
		});
		if (existing) {
			return fail(400, { error: `${domain} is already being watched` });
		}

		const [row] = await db.insert(watchedDomain).values({ domain }).returning();

		try {
			await refreshDomain(row.id, domain, { fetchDomainAuthority: true });
		} catch {
			// row is still created with pending status; user can retry via refresh
		}

		return { success: true };
	},

	exclude: async ({ request }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing domain id' });

		await db.update(watchedDomain).set({ isExcluded: true }).where(eq(watchedDomain.id, id));
		return { success: true };
	},

	refresh: async ({ request }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		const row = await db.query.watchedDomain.findFirst({ where: eq(watchedDomain.id, id) });
		if (!row) return fail(400, { error: 'Domain not found' });

		try {
			await refreshDomain(row.id, row.domain);
		} catch (err) {
			return fail(500, { error: err instanceof Error ? err.message : 'Lookup failed' });
		}

		return { success: true };
	},

	refreshAll: async () => {
		const rows = await db.query.watchedDomain.findMany({
			where: eq(watchedDomain.isExcluded, false)
		});

		const results = await Promise.allSettled(rows.map((row) => refreshDomain(row.id, row.domain)));
		const failed = results.filter((r) => r.status === 'rejected').length;

		await db
			.insert(appSetting)
			.values({ key: 'last_whois_check_at', value: String(Date.now()) })
			.onConflictDoUpdate({
				target: appSetting.key,
				set: { value: String(Date.now()) }
			});

		if (failed > 0) {
			return fail(500, { error: `${failed} of ${rows.length} domains failed to refresh` });
		}

		return { success: true };
	}
};
