# RUXY Trade Journal

RUXY is a trade journal with email-verified accounts. The included free-tier deployment uses Render for the web app, Neon for PostgreSQL, and Google Apps Script to send mail from your Gmail over HTTPS. It does not need a custom domain, SMTP credentials, or a credit card for Render's free web service. Free services can sleep and have provider usage limits; this setup is for personal/hobby use, not production-critical data.

## Deploy using free tiers

### 1. Create the free database

1. Create an account at [Neon](https://neon.com/) and create a free PostgreSQL project.
2. In the Neon project, choose **Connect** and copy the pooled connection string. It begins with `postgresql://` and includes `sslmode=require`. Keep it private.

### 2. Create the Gmail HTTPS mail relay

This lets the free Render service use Gmail without SMTP (Render blocks outbound SMTP on its free service).

1. Open [Google Apps Script](https://script.google.com/home/start), create a new project, and replace its editor contents with `server/google-mail-relay.gs` from this repository.
2. Create a long random secret (at least 32 random bytes). Store it in Apps Script under **Project Settings → Script Properties** with property name `MAIL_RELAY_SECRET`.
3. Select **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then deploy and approve Google's requested Gmail permission. Copy the web app URL ending in `/exec`. Do not share the secret.
4. Consumer Gmail quotas apply (Google currently limits Apps Script mail recipients per day); Google can change these limits. Verification messages count toward the quota.

### 3. Deploy the app on Render free

1. Push this updated project to GitHub.
2. In Render, close the payment-information prompt if it is open. Choose **New → Blueprint**, select the GitHub repository, and review `render.yaml`. It should show a **Free** web service and no disk.
3. When prompted for environment values, enter:
   - `DATABASE_URL` — the Neon connection string.
   - `GMAIL_RELAY_URL` — the Apps Script `/exec` URL.
   - `GMAIL_RELAY_SECRET` — exactly the same secret saved in Apps Script.
   - `EMAIL_FROM` — your Gmail address, e.g. `RUXY Journal <you@gmail.com>`.
4. Deploy, wait for it to finish, and open the Render service URL. Add `/health`; it should return `{"ok":true}`. Then open `/login.html`, register, and check your email for the verification link.

Render's free web service can spin down after inactivity and may take about a minute to wake. The PostgreSQL data is stored separately on Neon's free tier, so it isn't erased when the web service sleeps. Check both providers' current free-tier limits and terms.

The old Vercel configuration serves only static files and cannot run this authentication API. The older SQLite database and browser-local accounts are not automatically migrated. Passwords are stored as scrypt hashes; verification links are single-use and expire after 24 hours; login uses a server-managed HttpOnly cookie.

## Run locally

Install Node.js, run `npm install` in `server/`, set `DATABASE_URL`, `GMAIL_RELAY_URL`, `GMAIL_RELAY_SECRET`, and `EMAIL_FROM` from the steps above, then run `npm start` in `server/`. Open `http://localhost:3001/login.html` (not `file://` or VS Code Live Server).
