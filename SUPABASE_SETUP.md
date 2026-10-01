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

These are read by [`api/config.js`](api/config.js). Never add the `service_role` key to the frontend or Vercel client-visible configuration.

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
- Apply the SQL before deploying the app with the environment variables configured.
