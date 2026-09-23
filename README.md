# Domain Snatcher

A small SvelteKit app for watching domain names and getting notified when they become available.

## Features

- Track a list of watched domains and their expiration dates via WHOIS lookups
- Optional Domain Rating lookup via the Ahrefs API
- Optional email notifications (via Brevo) when a watched domain becomes available
- Email/password authentication via Better Auth

## Stack

- [SvelteKit](https://svelte.dev/docs/kit) + TypeScript
- [Drizzle ORM](https://orm.drizzle.team/) with SQLite
- [Better Auth](https://www.better-auth.com/) for authentication
- Tailwind CSS
- Vitest + Playwright for testing

## Getting started

Install dependencies:

```sh
pnpm install
```

Copy the example environment file and fill in the values you need:

```sh
cp .env.example .env
```

Push the database schema:

```sh
pnpm db:push
```

Start the dev server:

```sh
pnpm dev
```

## Scripts

| Command               | Description                                      |
| ---------------------- | ------------------------------------------------- |
| `pnpm dev`              | Start the dev server                               |
| `pnpm build`            | Build for production                               |
| `pnpm preview`          | Preview the production build                       |
| `pnpm check`            | Type-check the project                             |
| `pnpm lint`             | Run Prettier and ESLint checks                     |
| `pnpm format`           | Format the codebase                                |
| `pnpm test`             | Run unit and e2e tests                             |
| `pnpm db:push`          | Push the Drizzle schema to the database            |
| `pnpm db:studio`        | Open Drizzle Studio                                |
| `pnpm check:domains`    | Run the WHOIS refresh/notification check manually  |
| `pnpm check:dr`         | Refresh Domain Rating (Ahrefs) for all domains     |
| `pnpm check:dr:missing` | Refresh Domain Rating only for domains missing it  |

## Environment variables

See [`.env.example`](.env.example) for the full list. `DATABASE_URL` and `BETTER_AUTH_SECRET` are required; the Ahrefs and Brevo integrations are optional and are skipped gracefully when unset.
