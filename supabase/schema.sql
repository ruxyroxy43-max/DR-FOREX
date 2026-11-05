create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Z0-9_]{2,24}$'),
  email text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'disabled')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace jsonb not null default '{"trades":[],"notebookNotes":[],"sessionPreps":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.is_approved_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
begin
  requested_username := upper(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  if requested_username !~ '^[A-Z0-9_]{2,24}$' then
    raise exception 'Username must contain 2-24 letters, numbers, or underscores';
  end if;

  insert into public.profiles (id, username, email)
  values (new.id, requested_username, lower(new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.user_workspaces enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.user_workspaces from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (status, role) on public.profiles to authenticated;
grant select, insert, update on public.user_workspaces to authenticated;

 drop policy if exists "profile owner or admin can read profiles" on public.profiles;
create policy "profile owner or admin can read profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_approved_admin());

drop policy if exists "admins can update profiles" on public.profiles;
create policy "admins can update profiles"
on public.profiles for update to authenticated
using (public.is_approved_admin())
with check (public.is_approved_admin());

drop policy if exists "workspace owner or admin can read" on public.user_workspaces;
create policy "workspace owner or admin can read"
on public.user_workspaces for select to authenticated
using (user_id = auth.uid() or public.is_approved_admin());

drop policy if exists "workspace owner or admin can insert" on public.user_workspaces;
create policy "workspace owner or admin can insert"
on public.user_workspaces for insert to authenticated
with check (user_id = auth.uid() or public.is_approved_admin());

drop policy if exists "workspace owner or admin can update" on public.user_workspaces;
create policy "workspace owner or admin can update"
on public.user_workspaces for update to authenticated
using (user_id = auth.uid() or public.is_approved_admin())
with check (user_id = auth.uid() or public.is_approved_admin());
