import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { watchedDomain } from '$lib/server/db/schema';
import { lookupWhois } from '$lib/server/whois';
import { lookupSiteInfo } from '$lib/server/site-info';
import {
	lookupDomainAuthority,
	lookupBacklinksStats,
	lookupOrganicTraffic
} from '$lib/server/ahrefs';
import { sendDomainAvailableEmail } from '$lib/server/brevo';

export async function refreshDomain(
	id: string,
	domain: string,
	{ fetchDomainAuthority = false }: { fetchDomainAuthority?: boolean } = {}
) {
	const existing = await db.query.watchedDomain.findFirst({ where: eq(watchedDomain.id, id) });
	if (existing?.isExcluded) return;

	const previousStatus = existing?.lookupStatus ?? null;

	const [whoisResult, siteInfo, domainAuthorityResult, backlinksStatsResult, organicTrafficResult] =
		await Promise.allSettled([
			lookupWhois(domain),
			lookupSiteInfo(domain),
			fetchDomainAuthority ? lookupDomainAuthority(domain) : Promise.resolve(null),
			fetchDomainAuthority ? lookupBacklinksStats(domain) : Promise.resolve(null),
			fetchDomainAuthority ? lookupOrganicTraffic(domain) : Promise.resolve(null)
		]);

	const whois = whoisResult.status === 'fulfilled' ? whoisResult.value : null;
	const site = siteInfo.status === 'fulfilled' ? siteInfo.value : null;
	const domainAuthority =
		domainAuthorityResult.status === 'fulfilled' ? domainAuthorityResult.value : null;
	const backlinksStats =
		backlinksStatsResult.status === 'fulfilled' ? backlinksStatsResult.value : null;
	const organicTraffic =
		organicTrafficResult.status === 'fulfilled' ? organicTrafficResult.value : null;

	const lookupStatus =
		whoisResult.status === 'rejected' ? 'error' : whois?.available ? 'available' : 'ok';

	await db
		.update(watchedDomain)
		.set({
			expirationDate: whois?.expirationDate ?? null,
			registrar: whois?.registrar ?? null,
			title: site?.title ?? null,
			faviconUrl: site?.faviconUrl ?? `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
			// Keep the existing (possibly manually-entered) value when Ahrefs has
			// no key configured or the lookup fails, instead of clobbering it.
			...(domainAuthority !== null ? { domainAuthority } : {}),
			...(backlinksStats !== null ? backlinksStats : {}),
			...(organicTraffic !== null ? { organicTraffic } : {}),
			lookupStatus,
			lookupError:
				whoisResult.status === 'rejected'
					? String(whoisResult.reason?.message ?? whoisResult.reason)
					: null,
			lastCheckedAt: new Date()
		})
		.where(eq(watchedDomain.id, id));

	if (lookupStatus === 'available' && previousStatus !== 'available') {
		try {
			await sendDomainAvailableEmail(domain, {
				title: existing?.title ?? null,
				expirationDate: existing?.expirationDate ?? null,
				domainAuthority: existing?.domainAuthority ?? null
			});
		} catch (err) {
			console.error(`Failed to send availability email for ${domain}:`, err);
		}
	}
}
