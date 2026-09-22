export interface SiteInfo {
	title: string | null;
	faviconUrl: string;
}

async function fetchHtml(domain: string): Promise<string | null> {
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

export async function lookupSiteInfo(domain: string): Promise<SiteInfo> {
	const html = await fetchHtml(domain);
	const titleMatch = html?.match(/<title[^>]*>([^<]*)<\/title>/i);
	const title = titleMatch ? titleMatch[1].trim().slice(0, 200) || null : null;

	return {
		title,
		faviconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`
	};
}
