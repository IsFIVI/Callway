-- Supabase schema for the Callway landing lead collection.
-- Run this in Supabase SQL editor or migration runner before wiring the backend.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 120),
  last_name text not null check (char_length(last_name) between 1 and 120),
  phone_raw text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default timezone('utc', now()),
  source text not null default 'landing_web',
  summary text
);

create index if not exists leads_phone_e164_idx on public.leads using btree (phone_e164);

alter table public.leads enable row level security;

-- No policies are defined so far; only the service_role key (used server-side) bypasses RLS.
