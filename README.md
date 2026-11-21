# Pretty Penny

A personal, self-hosted envelope budgeting app.

This project is in early development. You can create budget and tracking accounts, record transactions with splits, transfers and schedules, assign money to categories with balances that roll over from month to month, reconcile accounts, see reports, and import your history from YNAB.

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
   /opt/homebrew/opt/postgresql@17/bin/createdb pretty_penny_dev
   /opt/homebrew/opt/postgresql@17/bin/createdb pretty_penny_test
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

4. Apply migrations to the development database. `npm test` migrates the test database automatically.

   ```sh
   npm run db:migrate
   ```

5. Set the password you'll sign in with. It must be at least 12 characters, and the command doesn't show it as you type. Run it again any time to change the password, which signs out every device.

   ```sh
   npm run set-password
   ```

6. Start the app, then open <http://localhost:5173> and sign in.

   ```sh
   npm run dev
   ```

Run `nvm use` in new terminal sessions so you're on the project's Node version.

## Commands

| Command                 | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `npm run dev`           | Starts the API and client                      |
| `npm test`              | Runs all unit, API and browser tests           |
| `npm run test:unit`     | Runs unit and API tests only                   |
| `npm run test:e2e`      | Runs Playwright browser tests only             |
| `npm run test:coverage` | Runs unit and API tests with a coverage report |
| `npm run lint`          | Checks code with ESLint and Prettier           |
| `npm run format`        | Formats code with Prettier                     |
| `npm run build`         | Type-checks and builds the client and server   |
| `npm run db:generate`   | Generates a migration from schema changes      |
| `npm run db:migrate`    | Applies migrations to `DATABASE_URL`           |
| `npm run set-password`  | Sets or changes the sign-in password           |

## Importing from YNAB

Open **Import from YNAB** in the sidebar. You'll need a personal access token, which you create in YNAB under Account Settings, then Developer Settings. Pretty Penny sends it to YNAB's API to read your plan and never saves it. You can revoke the token in YNAB afterward.

The import shows a preview of what will be created and what changes, such as credit card payment categories, which aren't imported because Pretty Penny treats cards like cash. Afterward it compares every account balance and category with YNAB's figures and explains any differences.

Importing only works on an empty budget. To start over in development, recreate the database. This deletes everything in it.

```sh
/opt/homebrew/opt/postgresql@17/bin/dropdb pretty_penny_dev
/opt/homebrew/opt/postgresql@17/bin/createdb pretty_penny_dev
npm run db:migrate
```

## Keeping data private

Never commit real financial data, bank or budget exports, database dumps, or `.env` files. Test fixtures must use made-up data.
