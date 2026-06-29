-- RecipeVault — database schema, Row-Level Security, and Realtime setup.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- This app is MULTI-USER but invite-only: each person signs in with a magic link and sees
-- ONLY their own data. Set it up as:
--   Dashboard → Authentication → Providers → Email: keep enabled (magic link).
--   Dashboard → Authentication → Sign In / Up → DISABLE "Allow new users to sign up".
--   Dashboard → Authentication → Users → "Add user" for each person (e.g. you + partner),
--   tick "Auto Confirm User". Every owner-scoped policy below — `owner_id = auth.uid()` —
--   resolves to "that signed-in user's rows only". (food_cache is shared on purpose.)
--
-- The script is idempotent / safe to re-run: create-if-not-exists tables, guarded column
-- adds, drop-and-recreate policies (Postgres has no "create policy if not exists"), and a
-- guarded realtime publication block. It never drops a table or deletes a row.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables  (Postgres mirror of the old local SQLite schema, now owner-scoped)
-- ─────────────────────────────────────────────────────────────────────────────

-- Recipe definitions. id stays a bigint (the renderer types recipe ids as `number`).
create table if not exists public.recipes (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  source_url  text,
  image_url   text,
  description text not null default '',
  servings    integer,
  prep_min    integer,
  cook_min    integer,
  total_min   integer,
  created_at  timestamptz not null default now()
);

-- Parsed ingredient lines. on delete cascade → deleting a recipe clears these in one go.
create table if not exists public.ingredients (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id    bigint not null references public.recipes (id) on delete cascade,
  position     integer not null,
  raw_text     text not null,
  quantity     real,
  quantity_max real,
  unit         text,
  name         text not null
);

-- Method steps. Same cascade behaviour as ingredients.
create table if not exists public.steps (
  id        bigint generated always as identity primary key,
  owner_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipe_id bigint not null references public.recipes (id) on delete cascade,
  position  integer not null,
  section   text,
  text      text not null
);

-- One row per weekday. recipe_id `on delete set null` so deleting a planned recipe just
-- empties that day. meal_text is a denormalised label the Discord bot reads (no join).
create table if not exists public.meal_plan (
  owner_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day       text not null check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  recipe_id bigint references public.recipes (id) on delete set null,
  free_text text,
  meal_text text,
  primary key (owner_id, day)
);

-- The built-in grocery list (replaces the old Google Tasks push).
create table if not exists public.grocery_items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  qty_text   text,
  checked    boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ingredients_recipe_idx   on public.ingredients (recipe_id, position);
create index if not exists steps_recipe_idx         on public.steps (recipe_id, position);
create index if not exists grocery_owner_state_idx  on public.grocery_items (owner_id, checked, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security: single-user, so every table is "your rows only" for all ops.
-- The owner_id default (auth.uid()) stamps inserts; the policy guards every operation.
-- Each policy is dropped-then-created so the whole script stays re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.recipes       enable row level security;
alter table public.ingredients   enable row level security;
alter table public.steps         enable row level security;
alter table public.meal_plan     enable row level security;
alter table public.grocery_items enable row level security;

drop policy if exists "recipes: own rows" on public.recipes;
create policy "recipes: own rows" on public.recipes
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "ingredients: own rows" on public.ingredients;
create policy "ingredients: own rows" on public.ingredients
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "steps: own rows" on public.steps;
create policy "steps: own rows" on public.steps
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "meal_plan: own rows" on public.meal_plan;
create policy "meal_plan: own rows" on public.meal_plan
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "grocery_items: own rows" on public.grocery_items;
create policy "grocery_items: own rows" on public.grocery_items
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Macro tracker
-- profiles: one row per auth user (display name + daily goals). The app upserts the row
-- on first sign-in. food_log: owner-scoped daily entries; macros are stored per ONE unit,
-- so a day's total is base_* × amount. food_cache: a SHARED barcode→macros cache (the
-- OpenFoodFacts data isn't private), so one person's scan benefits everyone.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  cal_goal     real,
  protein_goal real,
  carbs_goal   real,
  fat_goal     real
);

create table if not exists public.food_log (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date      date not null,
  meal_type     text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  name          text not null,
  brand         text,
  amount        real not null default 1,
  unit          text not null default 'serving',
  base_calories real not null default 0,
  base_protein  real not null default 0,
  base_carbs    real not null default 0,
  base_fat      real not null default 0,
  barcode       text,
  source        text not null default 'manual',
  created_at    timestamptz not null default now()
);
create index if not exists food_log_owner_day_idx on public.food_log (owner_id, log_date);

create table if not exists public.food_cache (
  barcode          text primary key,
  name             text not null,
  brand            text,
  serving_desc     text,
  unit             text not null,
  cal_per_unit     real not null default 0,
  protein_per_unit real not null default 0,
  carbs_per_unit   real not null default 0,
  fat_per_unit     real not null default 0,
  last_fetched     timestamptz not null default now()
);

alter table public.profiles   enable row level security;
alter table public.food_log   enable row level security;
alter table public.food_cache enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "food_log: own rows" on public.food_log;
create policy "food_log: own rows" on public.food_log
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- food_cache is shared: any authenticated user may read, insert, and refresh entries.
drop policy if exists "food_cache: shared read" on public.food_cache;
create policy "food_cache: shared read" on public.food_cache
  for select to authenticated using (true);
drop policy if exists "food_cache: shared insert" on public.food_cache;
create policy "food_cache: shared insert" on public.food_cache
  for insert to authenticated with check (true);
drop policy if exists "food_cache: shared update" on public.food_cache;
create policy "food_cache: shared update" on public.food_cache
  for update to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: broadcast changes so the PWA (phone) and the Electron app (desktop) update
-- live off the same backend. Guarded so re-runs don't error.
-- (The Discord bot does NOT use realtime — it reads meal_plan via REST on demand.)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['recipes','ingredients','steps','meal_plan','grocery_items','food_log']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
