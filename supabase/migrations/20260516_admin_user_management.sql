-- Admin dashboard prerequisites:
-- adds is_admin (gates the dashboard) and disabled (blocks the user's API key)
-- to profiles, plus a unique index on api_key for fast lookups.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.profiles
  add column if not exists disabled boolean not null default false;

-- Speed up the X-API-Key -> user lookup used on every authenticated request.
create unique index if not exists profiles_api_key_unique
  on public.profiles (api_key)
  where api_key is not null;

-- After running this, promote yourself to admin:
--   update public.profiles set is_admin = true where id = '<your-uuid>';
