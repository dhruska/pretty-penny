# Running Pretty Penny at home

This guide sets up Pretty Penny on a Mac that stays on at home, such as a Mac mini, and makes it reachable from your phone and laptop through [Tailscale](https://tailscale.com). It runs directly on macOS, without Docker.

When you're done:

- Postgres and Pretty Penny start on their own whenever you log in to the Mac.
- Pretty Penny is reachable only on your tailnet, at an HTTPS address like `https://mac-mini.your-tailnet.ts.net`. Nothing is open to your home network or the internet.
- Updating is one command.

You'll need an Apple silicon Mac on a recent macOS, a Tailscale account with this Mac and your other devices on it, and about half an hour.

## 1. Set up the Mac

In **System Settings**:

- **Energy**: turn on **Prevent automatic sleeping when the display is off** and **Start up automatically after a power failure**.
- **General → Date & Time**: check the time zone is yours. Scheduled transactions post by the Mac's clock.

If FileVault is on, which is a good idea, the Mac waits at the login screen after any restart, including after a power cut. Log in, and Postgres and Pretty Penny start. You can lock the screen afterward; they keep running.

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
API_PORT=3001
SECURE_COOKIES=true
# Filled in at step 6.
PUBLIC_URL=
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

The service starts now and whenever you log in, and restarts if it stops. `status.sh` should show everything OK except Tailscale, which comes next.

## 6. Turn on HTTPS through Tailscale

1. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
2. Find Tailscale's command line tool. If `tailscale version` works in Terminal, use `tailscale`. Otherwise, with the Tailscale app from the App Store or Tailscale's website, it's inside the app; add this line to `~/.zshrc` and open a new Terminal window:

   ```sh
   alias tailscale=/Applications/Tailscale.app/Contents/MacOS/Tailscale
   ```

3. Serve Pretty Penny over HTTPS on your tailnet. This keeps running in the background and survives restarts.

   ```sh
   tailscale serve --bg 3001
   ```

   It prints the address, like `https://mac-mini.your-tailnet.ts.net`. If it reports that serving isn't supported, install the standalone Tailscale app from [Tailscale's website](https://tailscale.com/download/mac) instead of the App Store version, then try again.

4. Put that address in `.env` as `PUBLIC_URL`, with no slash at the end, then restart and check:

   ```sh
   deploy/install-service.sh
   deploy/status.sh
   ```

   Everything should now be OK.

## 7. Use it

On your phone and laptop, open the address from step 6 and sign in. Your devices need to be connected to Tailscale.

- **iPhone**: in Safari, tap Share, then **Add to Home Screen**, for a penny icon that opens Pretty Penny full screen.
- **Coming from YNAB**: open **Import from YNAB** in the menu.

## Updating

```sh
cd ~/pretty-penny
deploy/update.sh
```

It gets the latest code, installs, builds, updates the database, restarts the service and checks it, stopping at the first problem.

## Backing up

Automatic backups aren't built yet. Until they are, back up by hand to a folder outside `~/pretty-penny`, such as an external drive. The file holds all your financial data, so keep it somewhere private.

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_dump -Fc pretty_penny > /Volumes/YOUR_DRIVE/pretty-penny-$(date +%F).dump
```

## Troubleshooting

Start with `deploy/status.sh`, which checks each part.

- **Postgres isn't running**: `brew services restart postgresql@17`.
- **The service isn't loaded**: `deploy/install-service.sh`.
- **Pretty Penny doesn't answer**: read the end of its log, `~/Library/Logs/PrettyPenny/com.prettypenny.server.log`. A wrong `DATABASE_URL` shows up there.
- **Tailscale isn't serving**: `tailscale serve status`, and `tailscale serve --bg 3001` again if needed.
- **"Changes must come from Pretty Penny itself"**: `PUBLIC_URL` in `.env` doesn't match the address you opened. Fix it, then `deploy/install-service.sh`.
- **Forgot the password**: `npm run set-password` sets a new one and signs out every device.
- **Stopping Pretty Penny**: `deploy/uninstall-service.sh` stops and removes the service. Your data stays in Postgres, and `deploy/install-service.sh` brings it back.
