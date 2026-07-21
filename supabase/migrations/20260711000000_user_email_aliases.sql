-- Additional emails that map to an existing journey user ("one user, many
-- emails"). The huddle-proxy consults this when a Huddle sign-in email isn't the
-- user's primary profiles.email, so a person can sign in with any of their
-- addresses (e.g. a workforce Entra alias) and reach the same journey records.
create table if not exists public.user_email_aliases (
  email      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists user_email_aliases_user_id_idx
  on public.user_email_aliases(user_id);

-- Service-role only. The huddle-proxy queries this with the service key (which
-- bypasses RLS); enabling RLS with no policies denies all anon/authenticated access.
alter table public.user_email_aliases enable row level security;
