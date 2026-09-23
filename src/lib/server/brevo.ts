import { env } from '$env/dynamic/private';

const API_URL = 'https://api.brevo.com/v3/smtp/email';

export interface DomainAvailableInfo {
	title: string | null;
	expirationDate: Date | null;
	domainAuthority: number | null;
}

function formatDate(date: Date | null): string | null {
	if (!date) return null;
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function sendDomainAvailableEmail(
	domain: string,
	info: DomainAvailableInfo = { title: null, expirationDate: null, domainAuthority: null }
): Promise<void> {
	if (!env.BREVO_API_KEY || !env.BREVO_NOTIFY_EMAIL || !env.BREVO_SENDER_EMAIL) return;

	const details: string[] = [];
	if (info.title) details.push(`<li><strong>Title:</strong> ${info.title}</li>`);
	const expired = formatDate(info.expirationDate);
	if (expired) details.push(`<li><strong>Last expiration date:</strong> ${expired}</li>`);
	if (info.domainAuthority !== null) {
		details.push(`<li><strong>Domain Rating (Ahrefs):</strong> ${info.domainAuthority}</li>`);
	}

	const res = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'api-key': env.BREVO_API_KEY,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify({
			sender: { email: env.BREVO_SENDER_EMAIL, name: 'Codelion Domain Snatcher' },
			to: [{ email: env.BREVO_NOTIFY_EMAIL }],
			subject: `${domain} is available!`,
			htmlContent: `<p><strong>${domain}</strong> is now available to register.</p>${details.length ? `<ul>${details.join('')}</ul>` : ''}`
		})
	});

	if (!res.ok) {
		throw new Error(`Brevo API returned ${res.status}: ${await res.text()}`);
	}
}
