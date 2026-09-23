import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { watchedDomain } from '$lib/server/db/schema';

export const load: PageServerLoad = async () => {
	const domains = await db.query.watchedDomain.findMany({
		where: eq(watchedDomain.isExcluded, true),
		orderBy: asc(watchedDomain.domain)
	});
	return { domains };
};

export const actions: Actions = {
	remove: async ({ request }) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing domain id' });

		await db.delete(watchedDomain).where(eq(watchedDomain.id, id));
		return { success: true };
	}
};
