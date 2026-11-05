# Supabase setup

## 1. Create the tables and policies

In Supabase, open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates:

- `profiles` for usernames, roles, and admin approval status.
- `user_workspaces` for each user's trades, notebook notes, and session preparation data.
- Row-level security so users can access only their own workspace; approved admins can review accounts and workspaces.

## 2. Configure Auth

In **Authentication → URL Configuration**, add your deployed Vercel URL to the allowed redirect URLs. Set a minimum password length of at least 8 characters. Email confirmation is recommended for real accounts.

## 3. Add Vercel environment variables

In **Vercel → Project → Settings → Environment Variables**, add:

- `SUPABASE_URL`: Project URL from **Project Settings → API**.
- `SUPABASE_ANON_KEY`: publishable/anon key from **Project Settings → API**.

`SUPABASE_PUBLISHABLE_KEY` is also supported for projects using Supabase's newer key name. These are read by [`api/config.js`](api/config.js). Never add the `service_role` key to the frontend or Vercel client-visible configuration. After adding or changing variables, redeploy the Vercel project so the serverless function receives them.

The project includes [`vercel.json`](vercel.json). Vercel automatically deploys `api/config.js` as a Node serverless function when the `api/` folder is present. Make sure the Vercel project root is the folder containing `index.html`, `api/`, `supabase/`, and `vercel.json`. When uploading through GitHub, upload the complete folders, not only the files shown at the repository root.

If the deployed URL displays Vercel `404: NOT_FOUND`, open Vercel **Project Settings → General** and set **Root Directory** to the repository root (the folder containing `index.html`), then redeploy. The repository must contain `index.html` at that root; do not set the root directory to `api` or `supabase`.

## 4. Create the admin account

Sign up through the deployed app with the admin's email and username `STYVE`. After the profile is created and email-confirmed if required, run this in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin', status = 'approved'
where username = 'STYVE';
```

Keep the admin password private. New user profiles default to `pending`; an approved admin can approve or reject them in the dashboard.

## Notes

- Supabase Auth uses email and passwords of at least 8 characters; the old four-character demo passwords are not used in backend mode.
- Existing demo trades and notes remain in local browser storage. They are not automatically uploaded to Supabase.
- Approved administrators can open an approved user's workspace from **Accounts** without knowing that user's password. The workspace shows an impersonation banner and a **Return to admin** action. This is an administrative workspace view, not a second Supabase login.
- Apply the SQL before deploying the app with the environment variables configured.


## Account management

New users register with an email address, username, and password of at least 8 characters. They remain `pending` until an approved administrator approves them. Administrators can approve, reject, disable, and re-enable accounts from the Accounts panel. Disabled accounts cannot sign in until re-enabled.

Administrators can send a password-reset email to a user. Supabase stores passwords as secure hashes, so plaintext passwords are never viewable by the administrator. Users must use the reset link to choose a new password.

Profile statuses are `pending`, `approved`, `rejected`, and `disabled`. Hosted users sign in with their registered email address and password from any device or Chrome profile.
