# RUXY Trade Journal

RUXY is a trade journal served by the included Node.js/Express server. User accounts require the server and a configured email provider; opening the HTML files directly or deploying only the static site will not support registration, verification, or login.

## Run locally

1. Install Node.js, then in `server/` run `npm install`.
2. Copy `server/.env.example` to `server/.env` and fill in the settings. Resend is recommended and sends over HTTPS:
   - `APP_URL` — public base URL used in verification links (for local use: `http://localhost:3001`).
   - `RESEND_API_KEY` — API key from your Resend account.
   - `EMAIL_FROM` — sender address authorized by Resend, for example `RUXY Journal <no-reply@your-domain.com>`.
   - Alternatively, SMTP can be configured with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_SECURE`.
   - `NODE_ENV=production` on production deployments so authentication cookies use HTTPS-only `Secure` mode.
3. Start the server with `npm start` and open `http://localhost:3001/login.html` (not VS Code Live Server or a `file://` URL).
4. Create an account, click the verification link delivered by email, then log in with the username and password from any device.

The SQLite database is created at `server/data.sqlite`. Keep this file on persistent storage and back it up. Passwords are stored as scrypt hashes; verification tokens are single-use and expire after 24 hours. Login uses a server-side session in an HttpOnly cookie.

## Deploy the working app

The included `render.yaml` deploys the frontend and API together and mounts SQLite on a persistent disk. This uses a paid Render Starter service because the free service does not provide persistent disks.

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect the repository, and deploy the `render.yaml` blueprint.
3. Enter `RESEND_API_KEY` and `EMAIL_FROM` when Render prompts for the secret environment variables. Create a Resend account, verify a sender domain, and create an API key. Use a sender address on that verified domain. Do not commit or share the API key. Resend's test sender can only deliver to authorized test recipients until a domain is verified.
4. After deployment, open the Render service URL and create an account. The server uses Render's public service URL for email verification links automatically. If you attach a custom domain, set `APP_URL` in Render to that domain.

The current Vercel configuration is static-only and excludes `server/`; it cannot provide this authentication flow. Open the deployed Render URL, not the old Vercel URL, so the frontend and API share the same origin.

The previous browser-local accounts are not imported. Create a new account and verify its email. Existing local trade entries remain in that browser and are not automatically imported into the server database.
