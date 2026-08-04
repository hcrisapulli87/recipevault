-- RecipeVault — database schema, Row-Level Security, and Realtime setup.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- This app is MULTI-USER but invite-only (a two-person household). Set it up as:
--   Dashboard → Authentication → Providers → Email: keep enabled.
--   Dashboard → Authentication → Sign In / Up → DISABLE "Allow new users to sign up".
--   Dashboard → Authentication → Users → "Add user" for each person (e.g. you + partner),
--   tick "Auto Confirm User".
--
-- Sharing model (2026-08): ONE rule everywhere — "read all, write only your own".
-- Recipes, food logs, profiles, the MEAL PLAN and the GROCERY LIST are all readable
-- by both household users, and every write requires `owner_id = auth.uid()`. The app
-- shows your own data with a Me/partner switcher for a read-only look at theirs, the
-- same way the tracker always has. (The 2026-07 glass redesign briefly made the plan
-- and list fully shared; that is reverted below.) The barcode cache stays fully
-- private per user.
-- Since sign-ups are disabled, "any authenticated user" means exactly the household.
--
-- The script is idempotent / safe to re-run: create-if-not-exists tables, guarded column
-- adds, drop-and-recreate policies (Postgres has no "create policy if not exists"), and a
-- guarded realtime publication block. It never drops a table. One exception on row
-- deletes, a one-time cutover that is a no-op on every later run: the 2026-07 three-meal
-- migration clears legacy one-meal-per-day planner rows. The 2026-08 un-sharing
-- migration below only ADDS rows.
--
-- Heads up: Supabase's SQL Editor warns about "destructive operations" because the file
-- contains the word DROP. Those are `drop policy if exists` lines that are recreated on
-- the next line (Postgres has no "create policy if not exists"). There is no DROP TABLE,
-- TRUNCATE, or unguarded DELETE — it is safe to run past the warning.

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

-- Macro-estimate summary (computed client-side from parsed ingredients; per serving).
-- Guarded adds so re-runs are no-ops.
alter table public.recipes add column if not exists est_cal_serve     real;
alter table public.recipes add column if not exists est_protein_serve real;
alter table public.recipes add column if not exists est_carbs_serve   real;
alter table public.recipes add column if not exists est_fat_serve     real;
alter table public.recipes add column if not exists est_matched       integer;
alter table public.recipes add column if not exists est_total         integer;
alter table public.recipes add column if not exists est_computed_at   timestamptz;

-- Catalog metadata (2026-08, meal planner v2). The app ships a seeded pool of ~170
-- recipes so a fresh week has something to plan WITH; they live in this same table
-- behind `is_catalog` rather than a parallel one, so grocery merge, macro estimates,
-- cooking mode and planner slots all keep working with no second code path.
-- `catalog_slug` is the seeder's idempotency key. `keeps_days` (fridge life, 0 = eat
-- fresh) and `reheat` are what the leftover engine chains on — a wrong value there
-- produces a bad plan, not a cosmetic blemish. Guarded adds, all defaulted, so every
-- existing row stays valid and re-runs are no-ops.
alter table public.recipes add column if not exists is_catalog     boolean not null default false;
alter table public.recipes add column if not exists catalog_slug   text;
alter table public.recipes add column if not exists cuisine        text;
alter table public.recipes add column if not exists diet_tags      text[] not null default '{}';
alter table public.recipes add column if not exists meal_slots     text[] not null default '{}';
alter table public.recipes add column if not exists effort         text;
alter table public.recipes add column if not exists keeps_days     integer not null default 0;
alter table public.recipes add column if not exists batch_friendly boolean not null default false;
alter table public.recipes add column if not exists reheat         text;

-- Unique only where present: personal imports leave catalog_slug null, and Postgres
-- treats nulls as distinct in a unique index, so a partial index is not strictly
-- required — but it keeps the index small (catalog rows only).
create unique index if not exists recipes_catalog_slug_key
  on public.recipes (catalog_slug) where catalog_slug is not null;
create index if not exists recipes_catalog_idx on public.recipes (is_catalog, cuisine);

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

-- One row per OWNER per weekday MEAL SLOT (breakfast/lunch/dinner) — each person plans
-- their own week and can view the other's read-only (2026-08; see the un-sharing
-- migration below). recipe_id `on delete set null` so deleting a planned recipe just
-- empties that slot. meal_text is a denormalised label the Discord bot reads (no join) —
-- it groups by owner_id and posts a section per person.
create table if not exists public.meal_plan (
  owner_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day       text not null check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  meal      text not null check (meal in ('breakfast','lunch','dinner')),
  recipe_id bigint references public.recipes (id) on delete set null,
  free_text text,
  meal_text text,
  primary key (owner_id, day, meal)
);

-- Leftovers (2026-08, meal planner v2). A leftover slot points at the SAME recipe_id as
-- its cook night — that is what lets groceries count the batch once and the tracker log
-- identical macros. `cook_day` is a label ("Leftovers from Tue"); `servings_planned` lives
-- on the cook night and drives grocery scaling. Guarded adds, defaulted, re-run safe.
alter table public.meal_plan add column if not exists is_leftover      boolean not null default false;
alter table public.meal_plan add column if not exists cook_day         text;
alter table public.meal_plan add column if not exists servings_planned integer;

-- Migration (2026-07): planner upgraded from one meal/day to three slots/day.
-- Legacy rows predate the meal column and can't be mapped to a slot, so they're
-- cleared once ("start fresh" cutover — the only row-delete in this script).
-- Every step is guarded, so re-runs and fresh installs are no-ops.
alter table public.meal_plan add column if not exists meal text;
delete from public.meal_plan where meal is null;
alter table public.meal_plan alter column meal set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meal_plan'::regclass and conname = 'meal_plan_meal_check'
  ) then
    alter table public.meal_plan
      add constraint meal_plan_meal_check check (meal in ('breakfast','lunch','dinner'));
  end if;
  -- If the table somehow has no PK at all (pre-2026-07 install), jump straight to the
  -- current end state. The 2-column → 3-column conversion lives in the next block.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meal_plan'::regclass and conname = 'meal_plan_pkey'
  ) then
    alter table public.meal_plan add constraint meal_plan_pkey primary key (owner_id, day, meal);
  end if;
end $$;

-- Migration (2026-08): the planner goes back to ONE WEEK PER PERSON, matching the tracker
-- (your own data, the partner's read-only behind the Me/partner switcher). The 2026-07
-- redesign had collapsed it to a single shared row per (day, meal); this reverses that.
--
-- Nobody should open the planner to a surprise empty week, so the existing shared week is
-- COPIED to every real household member (the bot is excluded — a service account has no
-- meals). Only the PK changes and only rows are ADDED; nothing is deleted. Guarded on the
-- 2-column PK, so this is a one-time cutover and a no-op on every later run.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.meal_plan'::regclass
      and conname = 'meal_plan_pkey' and array_length(conkey, 1) = 2
  ) then
    alter table public.meal_plan drop constraint meal_plan_pkey;
    alter table public.meal_plan add constraint meal_plan_pkey primary key (owner_id, day, meal);

    insert into public.meal_plan (
      owner_id, day, meal, recipe_id, free_text, meal_text,
      is_leftover, cook_day, servings_planned
    )
    select p.id, m.day, m.meal, m.recipe_id, m.free_text, m.meal_text,
           m.is_leftover, m.cook_day, m.servings_planned
    from public.meal_plan m
    cross join public.profiles p
    where p.is_bot = false
      and not exists (
        select 1 from public.meal_plan x
        where x.owner_id = p.id and x.day = m.day and x.meal = m.meal
      );
  end if;
end $$;

-- The built-in grocery list (replaces the old Google Tasks push). Owner-scoped again
-- as of 2026-08: your list is yours to add/check/remove, the partner's is visible
-- read-only. Existing rows keep the owner_id of whoever added them — a shopping list is
-- transient, so unlike the meal plan there is nothing worth copying across.
create table if not exists public.grocery_items (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  qty_text   text,
  checked    boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Instagram import relay: the phone inserts a reel URL; the desktop app (the only
-- device on a residential IP that can talk to Instagram) fetches the caption and
-- writes it back; the submitter's device parses it and opens the review form.
-- Transient work queue — rows are deleted after review.
create table if not exists public.import_queue (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url        text not null,
  status     text not null default 'pending' check (status in ('pending','fetched','failed')),
  caption    text,
  uploader   text,
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists ingredients_recipe_idx   on public.ingredients (recipe_id, position);
create index if not exists steps_recipe_idx         on public.steps (recipe_id, position);
create index if not exists grocery_owner_state_idx  on public.grocery_items (owner_id, checked, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security.
-- One rule for all of them (2026-08): household-readable, owner-writable. meal_plan and
-- grocery_items were briefly household-writable too (2026-07 glass redesign) and are
-- folded back into the same loop here, dropping those policies by name.
-- The owner_id default (auth.uid()) stamps inserts; policies guard every operation.
-- Each policy is dropped-then-created so the whole script stays re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.recipes       enable row level security;
alter table public.ingredients   enable row level security;
alter table public.steps         enable row level security;
alter table public.meal_plan     enable row level security;
alter table public.grocery_items enable row level security;

-- Reusable pattern: read-all / write-own. (Old single "own rows" policies from the
-- pre-sharing schema are dropped by name so re-runs upgrade cleanly.)
do $$
declare
  t text;
begin
  -- (food_log gets the same treatment in the tracker section below, after its create table.)
  foreach t in array array['recipes','ingredients','steps','meal_plan','grocery_items']
  loop
    execute format('drop policy if exists "%1$s: own rows" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: household read" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: household write" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner delete" on public.%1$I', t);
    execute format('create policy "%1$s: household read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- import_queue: household read + household UPDATE (the desktop app is signed in as
-- one user but must serve the other's queued fetches too); insert/delete stay owner-only.
alter table public.import_queue enable row level security;
drop policy if exists "import_queue: household read"   on public.import_queue;
drop policy if exists "import_queue: owner insert"     on public.import_queue;
drop policy if exists "import_queue: household update" on public.import_queue;
drop policy if exists "import_queue: owner delete"     on public.import_queue;
create policy "import_queue: household read"   on public.import_queue for select to authenticated using (true);
create policy "import_queue: owner insert"     on public.import_queue for insert to authenticated with check (owner_id = auth.uid());
create policy "import_queue: household update" on public.import_queue for update to authenticated using (true) with check (true);
create policy "import_queue: owner delete"     on public.import_queue for delete to authenticated using (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Macro tracker
-- profiles: one row per auth user (display name + daily goals). The app upserts the row
-- on first sign-in. food_log: owner-scoped daily entries; macros are stored per ONE unit,
-- so a day's total is base_* × amount. food_cache: a per-user barcode→macros cache so
-- re-scans are instant/offline (owner-scoped — no shared-mutable row another user could
-- poison; numeric bounds guard against garbage values).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  cal_goal     real,
  protein_goal real,
  carbs_goal   real,
  fat_goal     real,
  -- Service accounts (the Discord bot) are authenticated users too, but must never
  -- appear in the Me/partner switchers. The bot marks its own row on startup.
  is_bot       boolean not null default false
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
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  barcode          text not null,
  name             text not null,
  brand            text,
  serving_desc     text,
  unit             text not null,
  cal_per_unit     real not null default 0 check (cal_per_unit between 0 and 10000),
  protein_per_unit real not null default 0 check (protein_per_unit between 0 and 1000),
  carbs_per_unit   real not null default 0 check (carbs_per_unit between 0 and 1000),
  fat_per_unit     real not null default 0 check (fat_per_unit between 0 and 1000),
  last_fetched     timestamptz not null default now(),
  primary key (owner_id, barcode)
);

alter table public.profiles add column if not exists is_bot boolean not null default false;

-- The Generate-week wizard's answers (diet, cuisines, cook nights, serves, leftover
-- appetite, which meals to fill). Remembered per person so the second week is one tap to
-- the review step instead of six screens again. Shape is owned by the client
-- (shared/plan-prefs.ts) and read defensively, so adding a question later needs no
-- migration.
alter table public.profiles add column if not exists plan_prefs jsonb;

alter table public.profiles   enable row level security;
alter table public.food_log   enable row level security;
alter table public.food_cache enable row level security;

-- profiles: both household users can read (names for the switcher/chips, partner's
-- goals in the read-only tracker view); each user writes only their own row.
drop policy if exists "profiles: own row" on public.profiles;
drop policy if exists "profiles: household read" on public.profiles;
drop policy if exists "profiles: owner insert" on public.profiles;
drop policy if exists "profiles: owner update" on public.profiles;
drop policy if exists "profiles: owner delete" on public.profiles;
create policy "profiles: household read" on public.profiles
  for select to authenticated using (true);
create policy "profiles: owner insert" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles: owner update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: owner delete" on public.profiles
  for delete to authenticated using (id = auth.uid());

-- food_log: household-readable, owner-writable (same pattern as the recipe tables).
drop policy if exists "food_log: own rows" on public.food_log;
drop policy if exists "food_log: household read" on public.food_log;
drop policy if exists "food_log: owner insert" on public.food_log;
drop policy if exists "food_log: owner update" on public.food_log;
drop policy if exists "food_log: owner delete" on public.food_log;
create policy "food_log: household read" on public.food_log
  for select to authenticated using (true);
create policy "food_log: owner insert" on public.food_log
  for insert to authenticated with check (owner_id = auth.uid());
create policy "food_log: owner update" on public.food_log
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "food_log: owner delete" on public.food_log
  for delete to authenticated using (owner_id = auth.uid());

-- food_cache is per-user: each person reads/writes only their own cached barcodes, so no
-- one can poison a row another user reads. (Drop any earlier shared policies if present.)
drop policy if exists "food_cache: shared read" on public.food_cache;
drop policy if exists "food_cache: shared insert" on public.food_cache;
drop policy if exists "food_cache: shared update" on public.food_cache;
drop policy if exists "food_cache: own rows" on public.food_cache;
create policy "food_cache: own rows" on public.food_cache
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: broadcast changes so the PWA (phone) and the Electron app (desktop) update
-- live off the same backend. Guarded so re-runs don't error.
-- (The Discord bot does NOT use realtime — it reads meal_plan via REST on demand.)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['recipes','ingredients','steps','meal_plan','grocery_items','food_log','profiles','import_queue']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
