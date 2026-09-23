<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let removingId = $state<string | null>(null);
</script>

<svelte:head>
	<title>Excluded · Domain Snatcher</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10">
	<header class="mb-8">
		<h1 class="text-2xl font-semibold tracking-tight">Excluded domains</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Domains you've marked as not worth watching. They're never checked for whois or domain rating.
		</p>
		<nav class="mt-3 flex gap-4 text-sm">
			<a href={resolve('/')} class="text-muted-foreground hover:text-foreground hover:underline"
				>Domains</a
			>
			<a
				href={resolve('/keywords')}
				class="text-muted-foreground hover:text-foreground hover:underline">Keywords</a
			>
			<a href={resolve('/excluded')} class="font-medium underline">Excluded</a>
		</nav>
	</header>

	{#if data.domains.length === 0}
		<div class="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
			No excluded domains yet.
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full min-w-[480px] text-sm">
				<thead class="bg-muted/50 text-xs text-muted-foreground">
					<tr>
						<th class="px-4 py-2.5 text-left font-medium">Domain</th>
						<th class="px-4 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.domains as d (d.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-2.5">{d.domain}</td>
							<td class="px-4 py-2.5">
								<div class="flex items-center justify-end gap-1">
									<form
										method="POST"
										action="?/remove"
										use:enhance={() => {
											removingId = d.id;
											return async ({ update }) => {
												await update();
												removingId = null;
											};
										}}
									>
										<input type="hidden" name="id" value={d.id} />
										<Button
											type="submit"
											variant="ghost"
											size="icon"
											class="text-muted-foreground hover:text-destructive"
											disabled={removingId === d.id}
											aria-label="Remove {d.domain}"
										>
											<Trash2 class="size-4" />
										</Button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
