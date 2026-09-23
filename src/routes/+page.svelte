<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let adding = $state(false);
	let refreshingAll = $state(false);
	let excludingId = $state<string | null>(null);

	function daysUntil(date: Date | string | null): number | null {
		if (!date) return null;
		const target = new Date(date).getTime();
		return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '—';
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatDateTime(date: number | null): string {
		if (!date) return 'never';
		return new Date(date).toLocaleString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatCompactNumber(value: number | null): string {
		if (value === null) return '—';
		return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);
	}

	function urgencyClass(days: number | null): string {
		if (days === null) return 'text-muted-foreground';
		if (days <= 6) return 'text-destructive font-semibold';
		if (days <= 13) return 'text-orange-600 dark:text-orange-500 font-medium';
		return 'text-foreground';
	}
</script>

<svelte:head>
	<title>Domain Snatcher</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10">
	<header class="mb-8">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">Domain Snatcher</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					Watch competitor domains and know the moment they're up for grabs.
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Whois last checked: {formatDateTime(data.lastWhoisCheckAt)}
				</p>
			</div>
			<ModeToggle />
		</div>
		<nav class="mt-3 flex gap-4 text-sm">
			<a href={resolve('/')} class="font-medium underline">Domains</a>
			<a
				href={resolve('/keywords')}
				class="text-muted-foreground hover:text-foreground hover:underline">Keywords</a
			>
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
				name="domain"
				placeholder="example.com"
				required
				disabled={adding}
				class="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
			/>
			{#if form?.error}
				<p class="mt-1.5 text-xs text-destructive">{form.error}</p>
			{/if}
		</div>
		<Button type="submit" disabled={adding}>
			{adding ? 'Adding…' : 'Add domain'}
		</Button>
	</form>

	{#if data.domains.length === 0}
		<div class="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
			No domains yet. Add one above to start watching it.
		</div>
	{:else}
		<div class="mb-3 flex justify-end">
			<form
				method="POST"
				action="?/refreshAll"
				use:enhance={() => {
					refreshingAll = true;
					return async ({ update }) => {
						await update();
						refreshingAll = false;
					};
				}}
			>
				<Button type="submit" variant="outline" size="sm" disabled={refreshingAll}>
					{refreshingAll ? 'Refreshing…' : 'Refresh all'}
				</Button>
			</form>
		</div>
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full min-w-[840px] text-sm">
				<thead class="bg-muted/50 text-xs text-muted-foreground">
					<tr>
						<th class="px-4 py-2.5 text-left font-medium">Site</th>
						<th class="px-4 py-2.5 text-left font-medium">Domain</th>
						<th class="px-4 py-2.5 text-left font-medium">Expires</th>
						<th class="px-4 py-2.5 text-left font-medium">Days left</th>
						<th class="px-4 py-2.5 text-left font-medium">Registrar</th>
						<th class="px-4 py-2.5 text-left font-medium">DR</th>
						<th class="px-4 py-2.5 text-left font-medium">RD</th>
						<th class="px-4 py-2.5 text-left font-medium">Backlinks</th>
						<th class="px-4 py-2.5 text-left font-medium">Traffic</th>
						<th class="px-4 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.domains as d (d.id)}
						{@const days = daysUntil(d.expirationDate)}
						<tr
							class="hover:bg-muted/30 {d.lookupStatus === 'available'
								? 'bg-emerald-50 dark:bg-emerald-950/30'
								: ''}"
						>
							<td class="px-4 py-2.5">
								<div class="flex items-center gap-2">
									<img
										src={d.faviconUrl ??
											`https://www.google.com/s2/favicons?sz=64&domain=${d.domain}`}
										alt=""
										class="size-4 shrink-0 rounded-sm"
										loading="lazy"
									/>
									<span class="max-w-56 truncate" title={d.title ?? ''}>
										{d.title ?? (d.lookupStatus === 'pending' ? 'Looking up…' : '—')}
									</span>
								</div>
							</td>
							<td class="px-4 py-2.5">
								<a
									href={`https://${d.domain}`}
									target="_blank"
									rel="noreferrer noopener"
									class="hover:underline">{d.domain}</a
								>
								{#if d.lookupStatus === 'error'}
									<p class="mt-0.5 text-xs text-destructive" title={d.lookupError ?? ''}>
										Lookup failed
									</p>
								{/if}
							</td>
							<td class="px-4 py-2.5 whitespace-nowrap">{formatDate(d.expirationDate)}</td>
							<td class="px-4 py-2.5 whitespace-nowrap {urgencyClass(days)}">
								{#if d.lookupStatus === 'available'}
									<span class="font-semibold text-emerald-600 dark:text-emerald-400"
										>Available now!</span
									>
								{:else}
									{days === null ? '—' : days < 0 ? `expired ${-days}d ago` : `${days}d`}
								{/if}
							</td>
							<td class="px-4 py-2.5 text-muted-foreground">{d.registrar ?? '—'}</td>
							<td class="px-4 py-2.5 text-muted-foreground">{d.domainAuthority ?? '—'}</td>
							<td class="px-4 py-2.5 text-muted-foreground"
								>{formatCompactNumber(d.referringDomains)}</td
							>
							<td class="px-4 py-2.5 text-muted-foreground">{formatCompactNumber(d.backlinks)}</td>
							<td class="px-4 py-2.5 text-muted-foreground"
								>{formatCompactNumber(d.organicTraffic)}</td
							>
							<td class="px-4 py-2.5">
								<div class="flex items-center justify-end gap-1">
									<form
										method="POST"
										action="?/exclude"
										use:enhance={() => {
											excludingId = d.id;
											return async ({ update }) => {
												await update();
												excludingId = null;
											};
										}}
									>
										<input type="hidden" name="id" value={d.id} />
										<Button
											type="submit"
											variant="ghost"
											size="icon"
											class="text-muted-foreground hover:text-destructive"
											disabled={excludingId === d.id}
											aria-label="Exclude {d.domain}"
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
