# Running Pretty Penny at home

This guide sets up Pretty Penny on a Mac that stays on at home, such as a Mac mini, and makes it reachable from your phone and laptop through [Tailscale](https://tailscale.com). It runs directly on macOS, without Docker.

When you're done:

- Postgres and Pretty Penny start on their own whenever you log in to the Mac.
- Pretty Penny is reachable only on your tailnet, at its own HTTPS address like `https://budget.your-tailnet.ts.net`, through [Tailscale Services](https://tailscale.com/docs/features/tailscale-services). The Mac keeps its own name, and other apps on it can have addresses of their own. Nothing is open to your home network or the internet.
- Updating is one command.

You'll need an Apple silicon Mac on macOS 13 or later, a Tailscale account with this Mac and your other devices on it, and about half an hour. You'll need to be an Owner or Admin of your tailnet, which you are on a personal one.

## 1. Set up the Mac

In **System Settings**:

- **Energy**: turn on **Prevent automatic sleeping when the display is off** and **Start up automatically after a power failure**. In Terminal, `sudo pmset -a sleep 0` and `sudo pmset -a autorestart 1` do the same; `pmset -g` shows them.
- **General → Date & Time**: check the time zone is yours. Scheduled transactions post by the Mac's clock.

If FileVault is on, which is a good idea (`fdesetup status` says), the Mac waits at the login screen after any restart, including after a power cut. Log in, and Postgres and Pretty Penny start. You can lock the screen afterward; they keep running.

## 2. Install the tools

1. Install [Homebrew](https://brew.sh), following the instructions on its home page. It also installs Git.
2. Install [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), following its README, then open a new Terminal window.
3. Install Postgres 17 and start it. `brew services` starts it whenever you log in.

   ```sh
   brew install postgresql@17
   brew services start postgresql@17
   ```

4. Create a database user with a password, and a database it owns. Choose a long password of letters and numbers, so it can go into a URL as is.

   ```sh
   /opt/homebrew/opt/postgresql@17/bin/createuser --pwprompt pretty_penny
   /opt/homebrew/opt/postgresql@17/bin/createdb --owner pretty_penny pretty_penny
   ```

5. Make Postgres require that password. Open `/opt/homebrew/var/postgresql@17/pg_hba.conf` in a text editor. At the end, in every line starting with `host`, change `trust` to `scram-sha-256`. Leave the `local` lines as they are; they're for you at the Mac's own Terminal. Then restart Postgres:

   ```sh
   brew services restart postgresql@17
   ```

   Postgres listens only on the Mac itself, so other devices can't reach it.

## 3. Get the code

```sh
git clone https://github.com/dhruska/pretty-penny.git ~/pretty-penny
cd ~/pretty-penny
nvm install
npm ci
cp .env.example .env
chmod 600 .env
```

Edit `.env` so it holds just these lines, with your database password:

```sh
DATABASE_URL=postgres://pretty_penny:YOUR_DATABASE_PASSWORD@localhost:5432/pretty_penny
# Pretty Penny's port on this Mac. Any free one; an uncommon one leaves 3000-ish ports for other projects.
API_PORT=4730
SECURE_COOKIES=true
# Its address, from step 6: budget, then your tailnet's name, which the Tailscale admin console shows under DNS.
PUBLIC_URL=https://budget.your-tailnet.ts.net
# Filled in under Backing up.
BACKUP_DIRS=
# Filled in under Bank sync, if you use it.
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=
BANK_TOKEN_KEY=
```

## 4. Build and set up the database

```sh
npm run build
npm run db:migrate
npm run set-password
```

`set-password` asks for the password you'll sign in with, twice, without showing it. It must be at least 12 characters.

## 5. Start the service

```sh
deploy/install-service.sh
deploy/status.sh
```

The service starts now and whenever you log in, and restarts if it stops. `status.sh` should show everything OK except Tailscale, which comes next. To check the app itself, `curl http://127.0.0.1:4730/api/hello` should answer with a hello, using your `API_PORT`.

## 6. Give it an address through Tailscale

Tailscale Services gives Pretty Penny its own name on your tailnet, served from this Mac, with an HTTPS certificate. The steps use the name `budget`; any name works, as long as it's the same everywhere.

1. **Use Tailscale's standalone app**, version 1.86 or later. The App Store version can't host Services. If you have it, quit and delete it, then install the app from [Tailscale's website](https://tailscale.com/download/mac) and sign in.
2. **Find Tailscale's command line tool.** If `tailscale version` works in Terminal, use `tailscale`. Otherwise add this line to `~/.zshrc` and open a new Terminal window:

   ```sh
   alias tailscale=/Applications/Tailscale.app/Contents/MacOS/Tailscale
   ```

3. **Turn on MagicDNS and HTTPS Certificates** in the [Tailscale admin console](https://login.tailscale.com/admin/dns), under **DNS**.
4. **Allow a server tag, and let it serve `budget` without asking each time.** In the admin console's **Access controls**, add these inside the policy's outer braces, merging with any `tagOwners` or `autoApprovers` already there, and save:

   ```json
   "tagOwners": { "tag:server": [] },
   "autoApprovers": { "services": { "svc:budget": ["tag:server"] } },
   ```

   If the policy has `grants` or `acls` that don't already let your devices reach everything, also add this grant, so they can reach Pretty Penny:

   ```json
   { "src": ["autogroup:member"], "dst": ["svc:budget"], "ip": ["443"] }
   ```

5. **Tag this Mac.** On the **Machines** page, open its **⋯** menu, choose **Edit tags**, add `tag:server`, and save. Only tagged devices can host Services. A tagged device belongs to the tailnet rather than to you, its key no longer expires, and it can't go back to having no tags.
6. **Define the Service.** On the **Services** page, choose **Advertise**, then **Define a Service**. Name it `budget`, with the port `tcp:443`.
7. **Serve Pretty Penny under it**, from its port:

   ```sh
   tailscale serve --service=svc:budget --https=443 127.0.0.1:4730
   tailscale serve status
   ```

   It runs in the background. The tag and policy approve it automatically; if the **Services** page shows this Mac as pending, select **Approve**.

8. **Check.** `PUBLIC_URL` in `.env` must be `https://budget.` followed by your tailnet's name and `.ts.net`, with no slash at the end. If you changed it, run `deploy/install-service.sh`. Then:

   ```sh
   deploy/status.sh
   ```

   Everything should now be OK. After the Mac's first restart, run `tailscale serve status` once to confirm the Service is still served.

To serve another app from this Mac later, give it its own port, an `autoApprovers` line and a Service with its own name, and serve it the same way. Each Service has its own address on port 443, so they never clash.

## 7. Use it

On your phone and laptop, open `https://budget.your-tailnet.ts.net`, with your tailnet's name, and sign in. Your devices need to be connected to Tailscale, which works from anywhere, not just at home.

- **iPhone**: in Safari, tap Share, then **Add to Home Screen**, for a penny icon that opens Pretty Penny full screen.
- **Coming from YNAB**: open **Import from YNAB** in the menu.

## Updating

```sh
cd ~/pretty-penny
deploy/update.sh
```

It gets the latest code, installs, builds, updates the database, restarts the service and checks it, stopping at the first problem.

## Backing up

Every night at 3am, Pretty Penny saves a copy of its database to each backup folder you choose, checks that the copy reads back, and removes old ones. It keeps every backup from the last 30 days, plus the first backup of each month for a year. If the Mac is asleep or logged out at 3am, the backup runs at the next chance. Backups hold all your financial data, so they should only go somewhere encrypted.

These steps use two folders: one on an external drive and one in iCloud Drive. If one is lost, the other survives. You can use just one, or others.

1. **Check that both places are encrypted.**
   - **iCloud Drive**: in **System Settings**, select your name, then **iCloud**, and turn on **Advanced Data Protection**. Without it, Apple can read what's in iCloud Drive.
   - **External drive**: select it in Finder, then **File → Get Info**. **Format** should say **APFS (Encrypted)**. If it says APFS without "Encrypted", open Disk Utility, select the drive, and add a volume (the **+** button) formatted **APFS (Encrypted)**; this doesn't erase what's there. Use that volume for backups.

2. **Make a folder in each place**, such as `Pretty Penny Backups` on the drive and in iCloud Drive.

3. **Add the folders to `.env`**, separated by a colon. Spaces are fine, and `~` means your home folder. iCloud Drive's folder is `~/Library/Mobile Documents/com~apple~CloudDocs`.

   ```sh
   BACKUP_DIRS=/Volumes/YOUR_DRIVE/Pretty Penny Backups:~/Library/Mobile Documents/com~apple~CloudDocs/Pretty Penny Backups
   ```

4. **Back up once, and check the backup restores.** The check restores the newest backup into a throwaway database, compares it with your data, and deletes it.

   ```sh
   npm run backup
   npm run backup:check
   ```

5. **Install the nightly job.**

   ```sh
   deploy/install-backups.sh
   ```

   It prints the path of the program that runs backups. macOS doesn't let background jobs write to external drives without permission, so in **System Settings → Privacy & Security → Full Disk Access**, select **+**, press **Command-Shift-G**, paste that path, and add it. After an update that changes the project's Node version, the path changes and you'll need to add it again; the status check will show a failed backup if so.

6. **Try the job now** instead of waiting for 3am, then check:

   ```sh
   launchctl kickstart gui/$(id -u)/com.prettypenny.backup
   deploy/status.sh
   ```

   `status.sh` shows each folder's newest backup, and fails if one is missing or more than 36 hours old. The job's log is `~/Library/Logs/PrettyPenny/com.prettypenny.backup.log`.

Every so often, run `npm run backup:check` to confirm backups still restore.

### Restoring a backup

```sh
deploy/restore.sh "/Volumes/YOUR_DRIVE/Pretty Penny Backups/pretty-penny-2026-11-21-030000.dump"
```

It asks you to type `restore` to confirm. Then it backs up the current data, stops Pretty Penny, replaces everything with the backup, and starts Pretty Penny again. Every device is signed out; sign in with the password you had when the backup was made. If the file is in iCloud Drive and shows a cloud icon in Finder, open the folder in Finder first so it downloads.

To restore onto a new Mac, follow steps 1 to 4 of this guide (skip `npm run set-password`, since the backup has your password), then run `deploy/restore.sh` with the backup, then continue from step 5.

## Bank sync

Pretty Penny can link accounts to your banks through [Plaid](https://plaid.com). New bank transactions then arrive on their own for you to review, as in YNAB, and each bank's balance shows next to Pretty Penny's. You sign in to each bank in Plaid's window; Pretty Penny never sees your bank password. Plaid's free Trial plan is enough for personal use, with one limit: **10 bank logins in all**. Removing a connection doesn't give its login back, so when one stops working, use **Fix connection** rather than removing it and connecting again.

Pretty Penny stays reachable only on your tailnet. It asks Plaid for updates every hour, so Plaid never needs to reach it.

1. **Create a Plaid account** at [dashboard.plaid.com](https://dashboard.plaid.com/signup). New accounts start on the free Trial plan, which uses real bank data.

2. **Note your keys.** On the dashboard's **Keys** page, copy the client ID and the **Production** secret. Plaid's Sandbox secret works with test banks only, which is useful for trying it out first.

3. **Register the address banks send you back to.** Many banks sign you in on their own site and then return you to Pretty Penny. In the dashboard's **API** settings, under **Allowed redirect URIs**, add your `PUBLIC_URL` followed by `/bank/oauth`, such as:

   ```text
   https://budget.your-tailnet.ts.net/bank/oauth
   ```

4. **Make an encryption key.** Pretty Penny encrypts Plaid's access to your banks with this key before saving it. The key stays in `.env`, which isn't in the database or its backups.

   ```sh
   openssl rand -base64 32
   ```

   **Save it in your password manager.** Restoring a backup onto another Mac needs it; without it, you'd remove each connection and connect the bank again, using new logins.

5. **Add the settings to `.env`**, then restart and check:

   ```sh
   PLAID_CLIENT_ID=your client ID
   PLAID_SECRET=your Production secret
   PLAID_ENV=production
   BANK_TOKEN_KEY=the key from step 4
   ```

   ```sh
   deploy/install-service.sh
   deploy/status.sh
   ```

6. **Connect your banks.** Open **Bank connections** in the menu and select **Connect a bank**. Afterward, choose the Pretty Penny account for each bank account, add a new one, or leave it unlinked. A new account starts with the bank's balance today. You can also link an account from **Edit account**.

7. **Check where importing starts.** Each linked account shows "Importing from" a date, with **Change**. For an account you already had, it's 3 days before your newest reconciled transaction, as in YNAB, so reconciling before linking keeps the overlap small. Transactions you entered that match an import, by amount and within 10 days, aren't duplicated. Moving the date earlier on an account that started at the bank's balance moves that starting balance back too, so the account still matches the bank.

New transactions arrive every hour, or when you select **Import now** on an account. They count in your budget right away, marked as needing review, with an **Approve** button. **Approve all** approves an account's at once, **Reject** removes one for good, and saving an edit approves it too. Pending transactions show in their own section until they post. Right after connecting, Plaid can take a few minutes to gather history.

To try it with test banks first, use the Sandbox secret with `PLAID_ENV=sandbox`, and sign in to a test bank with the username `user_good` and password `pass_good`. Remove those connections before switching to `production`; connections don't move between the two.

## Troubleshooting

Start with `deploy/status.sh`, which checks each part.

- **Postgres isn't running**: `brew services restart postgresql@17`.
- **The service isn't loaded**: `deploy/install-service.sh`.
- **Pretty Penny doesn't answer**: read the end of its log, `~/Library/Logs/PrettyPenny/com.prettypenny.server.log`. A wrong `DATABASE_URL` shows up there.
- **Tailscale isn't serving**: `tailscale serve status`. If `svc:budget` is missing, run step 6's `tailscale serve --service=…` again. If the **Services** page shows this Mac as pending, approve it, and check step 6's `autoApprovers` line.
- **The address doesn't load**: check that Tailscale is connected on the device you're using, and that the policy lets it reach `svc:budget`.
- **"Changes must come from Pretty Penny itself"**: `PUBLIC_URL` in `.env` doesn't match the address you opened. Fix it, then `deploy/install-service.sh`.
- **A backup folder fails**: the status line says why. "Doesn't exist" usually means the drive isn't connected. "Not allowed" means the Full Disk Access step under Backing up is needed again.
- **A bank needs you to sign in again**: banks ask for this every so often. Open **Bank connections** and select **Fix connection**, which uses the same login.
- **Bank connections says something isn't set**: a Plaid setting in `.env` is missing or mistyped. Fix it, then `deploy/install-service.sh`.
- **"Can't be read with the current BANK_TOKEN_KEY"**: `.env` has a different key from the one the connections were saved with, as after restoring onto a new Mac. Put back the saved key from your password manager.
- **Forgot the password**: `npm run set-password` sets a new one and signs out every device.
- **Stopping Pretty Penny**: `deploy/uninstall-service.sh` stops and removes the service. Your data stays in Postgres, and `deploy/install-service.sh` brings it back.
