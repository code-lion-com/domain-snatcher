<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let adding = $state(false);
	let removingId = $state<string | null>(null);
	let searching = $state(false);
	let addingDomains = $state(false);

	interface FoundDomain {
		domain: string;
		keywords: string[];
		status: 'new' | 'watching' | 'excluded';
	}

	let results = $state<FoundDomain[]>([]);
	let selected = new SvelteSet<string>();
	let searchNotice = $state<string | null>(null);
	let excludingDomains = $state(false);

	let selectableDomains = $derived(results.filter((r) => r.status === 'new').map((r) => r.domain));

	$effect(() => {
		if (form?.results) {
			const newResults = form.results;
			results = newResults;
			selected.clear();
			for (const r of newResults) if (r.status === 'new') selected.add(r.domain);
			searchNotice =
				newResults.length === 0
					? 'No domains found for the current keywords.'
					: form.partial
						? `Search failed for ${form.partial} keyword(s); showing results from the rest.`
						: null;
		}
	});

	function toggle(domain: string) {
		if (selected.has(domain)) selected.delete(domain);
		else selected.add(domain);
	}

	function toggleAll() {
		if (selectableDomains.length > 0 && selectableDomains.every((d) => selected.has(d))) {
			for (const d of selectableDomains) selected.delete(d);
		} else {
			for (const d of selectableDomains) selected.add(d);
		}
	}
</script>

<svelte:head>
	<title>Keywords · Domain Snatcher</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10">
	<header class="mb-8">
		<h1 class="text-2xl font-semibold tracking-tight">Search keywords</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Keep a list of keywords, then search DuckDuckGo for domains worth watching.
		</p>
		<nav class="mt-3 flex gap-4 text-sm">
			<a href={resolve('/')} class="text-muted-foreground hover:text-foreground hover:underline"
				>Domains</a
			>
			<a href={resolve('/keywords')} class="font-medium underline">Keywords</a>
			<a
				href={resolve('/excluded')}
				class="text-muted-foreground hover:text-foreground hover:underline">Excluded</a
			>
		</nav>
	</header>

	<form
		method="POST"
		action="?/add"
		class="mb-8 flex items-start gap-2"
		use:enhance={() => {
			adding = true;
			return async ({ update }) => {
				await update();
				adding = false;
			};
		}}
	>
		<div class="flex-1">
			<input
				type="text"
				name="keyword"
				placeholder="e.g. cloud backup software"
				required
				disabled={adding}
				class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
			/>
			{#if form?.error && !form?.results}
				<p class="mt-1.5 text-xs text-destructive">{form.error}</p>
			{/if}
		</div>
		<Button type="submit" disabled={adding}>
			{adding ? 'Adding…' : 'Add keyword'}
		</Button>
	</form>

	{#if data.keywords.length === 0}
		<div class="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
			No keywords yet. Add one above.
		</div>
	{:else}
		<ul class="mb-8 flex flex-wrap gap-2">
			{#each data.keywords as k (k.id)}
				<li
					class="flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pr-1 pl-3 text-sm"
				>
					<span>{k.keyword}</span>
					<form
						method="POST"
						action="?/remove"
						use:enhance={() => {
							removingId = k.id;
							return async ({ update }) => {
								await update();
								removingId = null;
							};
						}}
					>
						<input type="hidden" name="id" value={k.id} />
						<Button
							type="submit"
							variant="ghost"
							size="icon-sm"
							class="text-muted-foreground hover:text-destructive"
							disabled={removingId === k.id}
							aria-label="Remove {k.keyword}"
						>
							<Trash2 class="size-3.5" />
						</Button>
					</form>
				</li>
			{/each}
		</ul>

		<form
			method="POST"
			action="?/search"
			use:enhance={() => {
				searching = true;
				searchNotice = null;
				return async ({ update }) => {
					await update();
					searching = false;
				};
			}}
		>
			<Button type="submit" disabled={searching}>
				{searching ? 'Searching DuckDuckGo…' : 'Search keywords on DuckDuckGo'}
			</Button>
		</form>
	{/if}

	{#if searchNotice}
		<p class="mt-4 text-sm text-muted-foreground">{searchNotice}</p>
	{/if}

	{#if results.length > 0}
		<form
			method="POST"
			action="?/addDomains"
			class="mt-6"
			use:enhance={({ submitter }) => {
				const excluding = submitter?.getAttribute('formaction')?.includes('excludeDomains');
				if (excluding) excludingDomains = true;
				else addingDomains = true;

				return async ({ result, update }) => {
					addingDomains = false;
					excludingDomains = false;
					if (result.type === 'success') {
						const changed = new Set([
							...((result.data?.added as string[] | undefined) ?? []),
							...((result.data?.excluded as string[] | undefined) ?? [])
						]);
						if (changed.size > 0) {
							results = results.filter((r) => !changed.has(r.domain));
							for (const domain of changed) selected.delete(domain);
						}
					}
					await update({ reset: false });
				};
			}}
		>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-medium">
					{results.length} domain{results.length === 1 ? '' : 's'} found
				</h2>
				<div class="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={toggleAll}
						disabled={selectableDomains.length === 0}
					>
						{selectableDomains.length > 0 && selectableDomains.every((d) => selected.has(d))
							? 'Deselect all'
							: 'Select all'}
					</Button>
					<Button
						type="submit"
						formaction="?/excludeDomains"
						variant="outline"
						size="sm"
						disabled={excludingDomains || selected.size === 0}
					>
						{excludingDomains ? 'Excluding…' : `Exclude selected (${selected.size})`}
					</Button>
					<Button type="submit" size="sm" disabled={addingDomains || selected.size === 0}>
						{addingDomains ? 'Adding…' : `Add selected (${selected.size})`}
					</Button>
				</div>
			</div>

			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full min-w-[520px] text-sm">
					<thead class="bg-muted/50 text-xs text-muted-foreground">
						<tr>
							<th class="w-10 px-4 py-2.5"></th>
							<th class="px-4 py-2.5 text-left font-medium">Domain</th>
							<th class="px-4 py-2.5 text-left font-medium">Matched keywords</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each results as r (r.domain)}
							<tr class="hover:bg-muted/30">
								<td class="px-4 py-2.5">
									{#if r.status === 'new'}
										<input
											type="checkbox"
											name="domain"
											value={r.domain}
											checked={selected.has(r.domain)}
											onchange={() => toggle(r.domain)}
											class="size-4 rounded border-input"
										/>
									{/if}
								</td>
								<td class="px-4 py-2.5">
									<div class="flex items-center gap-2">
										<a
											href={`https://${r.domain}`}
											target="_blank"
											rel="noreferrer noopener"
											class="hover:underline">{r.domain}</a
										>
										{#if r.status === 'watching'}
											<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
												Already watching
											</span>
										{:else if r.status === 'excluded'}
											<span
												class="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
											>
												Excluded
											</span>
										{/if}
									</div>
								</td>
								<td class="px-4 py-2.5 text-muted-foreground">{r.keywords.join(', ')}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</form>
	{/if}
</div>
