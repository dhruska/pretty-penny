# Pretty Penny

A personal, self-hosted envelope budgeting app.

This project is in early development. It currently contains the project scaffolding and a hello world page.

## Tech stack

- **Client:** React, Vite, TanStack Query, React Router, Tailwind, shadcn/ui
- **Server:** Node, Fastify, Drizzle
- **Database:** Postgres
- **Tests:** Vitest, Playwright

## Setup

You'll need [nvm](https://github.com/nvm-sh/nvm) and Postgres 17. These steps use Homebrew on macOS.

1. Install and start Postgres, then create the databases. Homebrew doesn't add this Postgres version to your `PATH`, so the commands use its full path.

   ```sh
   brew install postgresql@17
   brew services start postgresql@17
   /opt/homebrew/opt/postgresql@17/bin/createdb simple_budget_dev
   /opt/homebrew/opt/postgresql@17/bin/createdb simple_budget_test
   ```

2. Switch to the project's Node version and install dependencies.

   ```sh
   nvm install
   npm install
   npx playwright install chromium
   ```

3. Create your local environment file. It's ignored by git.

   ```sh
   cp .env.example .env
   ```

4. Apply migrations to both databases.

   ```sh
   npm run db:migrate
   DATABASE_URL=postgres://localhost:5432/simple_budget_test npm run db:migrate
   ```

5. Start the app, then open <http://localhost:5173>.

   ```sh
   npm run dev
   ```

Run `nvm use` in new terminal sessions so you're on the project's Node version.

## Commands

| Command               | What it does                                 |
| --------------------- | -------------------------------------------- |
| `npm run dev`         | Starts the API and client                    |
| `npm test`            | Runs all unit, API and browser tests         |
| `npm run test:unit`   | Runs unit and API tests only                 |
| `npm run test:e2e`    | Runs Playwright browser tests only           |
| `npm run lint`        | Checks code with ESLint and Prettier         |
| `npm run format`      | Formats code with Prettier                   |
| `npm run build`       | Type-checks and builds the client and server |
| `npm run db:generate` | Generates a migration from schema changes    |
| `npm run db:migrate`  | Applies migrations to `DATABASE_URL`         |

## Keeping data private

Never commit real financial data, bank or budget exports, database dumps, or `.env` files. Test fixtures must use made-up data.
