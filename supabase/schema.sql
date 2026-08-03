-- RecipeVault — database schema, Row-Level Security, and Realtime setup.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- This app is MULTI-USER but invite-only (a two-person household). Set it up as:
--   Dashboard → Authentication → Providers → Email: keep enabled.
--   Dashboard → Authentication → Sign In / Up → DISABLE "Allow new users to sign up".
--   Dashboard → Authentication → Users → "Add user" for each person (e.g. you + partner),
--   tick "Auto Confirm User".
--
-- Sharing model: recipes, food logs and profiles are READABLE by both household
-- users ("read all, write only your own" — writes always require
-- `owner_id = auth.uid()`). The MEAL PLAN and GROCERY LIST are fully SHARED
-- (2026-07 glass redesign): one household plan / one list, both users read AND
-- write. The barcode cache stays fully private per user.
-- Since sign-ups are disabled, "any authenticated user" means exactly the household.
--
-- The script is idempotent / safe to re-run: create-if-not-exists tables, guarded column
-- adds, drop-and-recreate policies (Postgres has no "create policy if not exists"), and a
-- guarded realtime publication block. It never drops a table. Two exceptions on row
-- deletes, both one-time cutovers that are no-ops on every later run: the 2026-07
-- three-meal migration clears legacy one-meal-per-day planner rows, and the 2026-07
-- shared-plan migration dedupes per-person planner rows down to one household row
-- per (day, meal).

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

-- One SHARED household row per weekday MEAL SLOT (breakfast/lunch/dinner) — the plan
-- is one plan for both users (2026-07 glass redesign). recipe_id `on delete set null`
-- so deleting a planned recipe just empties that slot. meal_text is a denormalised label
-- the Discord bot reads (no join). owner_id now means "last edited by" and keeps the
-- bot's REST reads working unchanged.
create table if not exists public.meal_plan (
  owner_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day       text not null check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  meal      text not null check (meal in ('breakfast','lunch','dinner')),
  recipe_id bigint references public.recipes (id) on delete set null,
  free_text text,
  meal_text text,
  primary key (day, meal)
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
  -- shared-plan end state. The 3-column → 2-column conversion lives in the next block.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meal_plan'::regclass and conname = 'meal_plan_pkey'
  ) then
    alter table public.meal_plan add constraint meal_plan_pkey primary key (day, meal);
  end if;
end $$;

-- Migration (2026-07, glass redesign): the planner became SHARED — one household plan,
-- one row per (day, meal). Old per-person rows are deduped (the second row-delete
-- cutover in this script): filled slots beat empty ones, and on a filled-vs-filled tie
-- Harrison's row wins (the Discord bot reads the plan, so his rows must survive).
-- Then the PK moves from (owner_id, day, meal) to (day, meal). Guarded: a no-op once
-- the 2-column PK exists.
do $$
declare
  harrison uuid;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.meal_plan'::regclass
      and conname = 'meal_plan_pkey' and array_length(conkey, 1) = 3
  ) then
    select id into harrison from auth.users where email = 'harrisonc2105@gmail.com';
    delete from public.meal_plan
    where ctid in (
      select ctid from (
        select ctid, row_number() over (
          partition by day, meal
          order by (recipe_id is not null or nullif(free_text, '') is not null) desc,
                   coalesce(owner_id = harrison, false) desc,
                   owner_id::text
        ) as rn
        from public.meal_plan
      ) ranked
      where rn > 1
    );
    alter table public.meal_plan drop constraint meal_plan_pkey;
    alter table public.meal_plan add constraint meal_plan_pkey primary key (day, meal);
  end if;
end $$;

-- The built-in grocery list (replaces the old Google Tasks push). SHARED since the
-- 2026-07 glass redesign: one household list, both users add/check/remove any row.
-- owner_id just records who added the item.
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
-- Recipe tables (recipes/ingredients/steps): household-readable, owner-writable.
-- Fully shared tables (meal_plan/grocery_items): household read AND write — one
-- plan, one list for the whole household (2026-07 glass redesign).
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
  foreach t in array array['recipes','ingredients','steps']
  loop
    execute format('drop policy if exists "%1$s: own rows" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: household read" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner delete" on public.%1$I', t);
    execute format('create policy "%1$s: household read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- meal_plan + grocery_items: fully shared — any household user can read and write
-- every row (same `using (true)` pattern as "import_queue: household update" below).
-- Old owner-scoped policies are dropped by name so re-runs upgrade cleanly.
do $$
declare
  t text;
begin
  foreach t in array array['meal_plan','grocery_items']
  loop
    execute format('drop policy if exists "%1$s: own rows" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: household read" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner delete" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: household write" on public.%1$I', t);
    execute format('create policy "%1$s: household read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s: household write" on public.%1$I for all to authenticated using (true) with check (true)', t);
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
