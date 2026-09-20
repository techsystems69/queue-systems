-- ══════════════════════════════════════════════════════════════
-- School Queue Management System
-- ══════════════════════════════════════════════════════════════
-- A second queue product living alongside the existing restaurant/retail
-- flow, in its own tables and its own /school route namespace. Nothing here
-- touches queue_entries / queue_state / counters.
--
-- Why separate tables rather than columns on the existing ones:
--   * tokens are per-department series with letter prefixes (A101, F201…)
--     that reset daily — queue_state is one integer per branch;
--   * a school serves from N windows at once — queue_state.current_serving_number
--     is a single shared slot that concurrent counters would overwrite;
--   * a school token must name the counter to walk to — queue_entries has no
--     counter_id.
--
-- NOTE: deliberately NOT mirrored into supabase/schema.sql. That file opens
-- with a `drop table … cascade` block, so school tables added there would be
-- silently orphaned (or wiped) on every re-run.
-- ══════════════════════════════════════════════════════════════


-- ── Product selector on the tenant ────────────────────────────
-- A customer account is either a business or a school; this drives which
-- product the login lands in.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'business';

DO $$ BEGIN
  ALTER TABLE public.customers ADD CONSTRAINT customers_vertical_check
    CHECK (vertical IN ('business', 'school'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Which board a registered screen renders ───────────────────
-- Screens are shared with the existing product (that gives the school the ads
-- cascade, the max_screens_per_branch quota and last_seen_at presence for
-- free). `kind` keeps one screen_token valid at exactly one board route.
ALTER TABLE public.screens
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'queue';

DO $$ BEGIN
  ALTER TABLE public.screens ADD CONSTRAINT screens_kind_check
    CHECK (kind IN ('queue', 'school'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ══════════════════════════════════════════════════════════════
-- 1. SETTINGS (one row per school branch)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_settings (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references public.customers(id) on delete cascade,
  branch_id            uuid not null unique references public.branches(id) on delete cascade,
  school_name_en       text not null default '',
  school_name_ar       text not null default '',
  logo_url             text not null default '',
  languages            text[] not null default '{en}',
  ticket_footer_en     text not null default '',
  ticket_footer_ar     text not null default '',
  kiosk_idle_seconds   int  not null default 20 check (kiosk_idle_seconds between 3 and 120),
  priority_enabled     boolean not null default true,
  announce_enabled     boolean not null default true,
  announce_template_en text not null default 'Token {token}, please proceed to {counter}',
  announce_template_ar text not null default 'التذكرة {token}، يرجى التوجه إلى {counter}',
  print_enabled        boolean not null default true,
  -- "Today" must be the school's local day, not UTC. Supabase runs UTC and the
  -- existing product derives dates in JS from toISOString(), which for Qatar
  -- (UTC+3) rolls the day at 03:00 local. Every school date is derived from
  -- these two columns in SQL instead — see school_service_date().
  timezone             text not null default 'Asia/Qatar',
  day_start_time       time not null default '00:00',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS school_settings_customer_idx
  ON public.school_settings(customer_id);


-- ══════════════════════════════════════════════════════════════
-- 2. DEPARTMENTS
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_departments (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  name_en       text not null,
  name_ar       text not null default '',
  prefix        text not null check (prefix ~ '^[A-Z]{1,3}$'),
  number_start  int  not null default 101 check (number_start between 1 and 99999),
  color         text not null default '#0F766E',
  icon          text not null default 'Building2',
  is_priority   boolean not null default false,
  display_order int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Two active departments sharing a prefix would collide on
-- school_tokens(branch_id, service_date, token_code) and start throwing at the
-- kiosk mid-day. Catch it at configuration time instead.
CREATE UNIQUE INDEX IF NOT EXISTS school_departments_branch_prefix_uniq
  ON public.school_departments(branch_id, prefix) WHERE is_active;

CREATE INDEX IF NOT EXISTS school_departments_branch_idx
  ON public.school_departments(branch_id, display_order);


-- ══════════════════════════════════════════════════════════════
-- 3. DAILY CURSOR (one row per department per service day)
-- ══════════════════════════════════════════════════════════════
-- The daily reset falls out of the schema: a new day has no row yet, so the
-- series restarts at the department's number_start. No cron, no reset button.
CREATE TABLE IF NOT EXISTS public.school_department_days (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  department_id uuid not null references public.school_departments(id) on delete cascade,
  service_date  date not null,
  next_number   int  not null,
  created_at    timestamptz not null default now(),
  constraint school_department_days_uniq unique (department_id, service_date)
);


-- ══════════════════════════════════════════════════════════════
-- 4. COUNTERS (service windows)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_counters (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete cascade,
  branch_id        uuid not null references public.branches(id) on delete cascade,
  name_en          text not null,
  name_ar          text not null default '',
  counter_token    text not null unique default gen_random_uuid()::text,
  -- Short numeric id a hardware calling keypad identifies itself with.
  keypad_code      text,
  -- Physical key -> action mapping; cheap keypads differ, so this is data.
  keypad_map       jsonb not null default '{}'::jsonb,
  accepts_priority boolean not null default true,
  display_order    int  not null default 0,
  is_active        boolean not null default true,
  is_open          boolean not null default true,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_counters_branch_keypad_uniq
  ON public.school_counters(branch_id, keypad_code) WHERE keypad_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS school_counters_branch_idx
  ON public.school_counters(branch_id, display_order);
CREATE INDEX IF NOT EXISTS school_counters_token_idx
  ON public.school_counters(counter_token);


-- ══════════════════════════════════════════════════════════════
-- 5. COUNTER <-> DEPARTMENT
-- ══════════════════════════════════════════════════════════════
-- A window serves one or more departments. `preference` is the operator's
-- primary-first ordering; it is folded into the call ordering as a small time
-- penalty rather than a hard sort key, so a secondary department can't starve.
CREATE TABLE IF NOT EXISTS public.school_counter_departments (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  counter_id    uuid not null references public.school_counters(id) on delete cascade,
  department_id uuid not null references public.school_departments(id) on delete cascade,
  preference    int  not null default 0,
  created_at    timestamptz not null default now(),
  constraint school_counter_departments_uniq unique (counter_id, department_id)
);

CREATE INDEX IF NOT EXISTS school_counter_departments_dept_idx
  ON public.school_counter_departments(department_id);


-- ══════════════════════════════════════════════════════════════
-- 6. TOKENS
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.school_tokens (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  department_id uuid not null references public.school_departments(id) on delete restrict,
  counter_id    uuid references public.school_counters(id) on delete set null,
  service_date  date not null,
  number        int  not null,
  token_code    text not null,
  status        text not null default 'waiting'
                check (status in ('waiting','called','held','served','no-show','cancelled')),
  is_priority   boolean not null default false,
  source        text not null default 'kiosk'
                check (source in ('kiosk','staff','web','api')),
  transferred_from_department_id uuid references public.school_departments(id) on delete set null,
  notes         text not null default '',
  joined_at     timestamptz not null default now(),
  called_at     timestamptz,
  served_at     timestamptz,
  call_count    int not null default 0,
  recall_count  int not null default 0,
  created_at    timestamptz not null default now(),
  constraint school_tokens_code_uniq unique (branch_id, service_date, token_code)
);

-- One live token per window, enforced by the database rather than by a
-- mutable "current_token_id" pointer that would drift on a crashed action.
CREATE UNIQUE INDEX IF NOT EXISTS school_tokens_one_called_per_counter
  ON public.school_tokens(counter_id) WHERE status = 'called';

CREATE INDEX IF NOT EXISTS school_tokens_branch_day_status_idx
  ON public.school_tokens(branch_id, service_date, status);
CREATE INDEX IF NOT EXISTS school_tokens_dept_day_status_idx
  ON public.school_tokens(department_id, service_date, status, joined_at);
CREATE INDEX IF NOT EXISTS school_tokens_customer_idx
  ON public.school_tokens(customer_id);


-- ══════════════════════════════════════════════════════════════
-- 7. ACTIVITY LOG (insert-only)
-- ══════════════════════════════════════════════════════════════
-- activity_logs can't be reused: its `type` CHECK is restaurant-specific and
-- entry_id is an FK to queue_entries.
CREATE TABLE IF NOT EXISTS public.school_activity_logs (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  token_id      uuid references public.school_tokens(id) on delete set null,
  counter_id    uuid references public.school_counters(id) on delete set null,
  department_id uuid references public.school_departments(id) on delete set null,
  performed_by  uuid references public.profiles(id) on delete set null,
  source        text not null default 'staff'
                check (source in ('kiosk','staff','web','api','system')),
  type          text not null
                check (type in ('issued','called','recalled','held','resumed','served',
                                'no-show','cancelled','transferred','counter-opened','counter-closed')),
  token_code    text not null default '',
  message       text not null default '',
  created_at    timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS school_activity_logs_branch_created_idx
  ON public.school_activity_logs(branch_id, created_at desc);
CREATE INDEX IF NOT EXISTS school_activity_logs_token_idx
  ON public.school_activity_logs(token_id);


-- ══════════════════════════════════════════════════════════════
-- RLS — service role only
-- ══════════════════════════════════════════════════════════════
-- RLS in this schema is self-referentially broken (profiles -> customers), so
-- every read and write goes through the service-role client behind the
-- requireX() guards in lib/dal/session.ts. Same rule as `counters`.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'school_settings', 'school_departments', 'school_department_days',
    'school_counters', 'school_counter_departments', 'school_tokens',
    'school_activity_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_only', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- REALTIME — deliberately NOT via postgres_changes
-- ══════════════════════════════════════════════════════════════
-- The school tables are not added to the supabase_realtime publication, and
-- that is on purpose.
--
-- postgres_changes is delivered to the browser under RLS, so subscribing from
-- a device page would require an anon SELECT policy. The existing product does
-- exactly that (`queue_entries_read_all ... using (true)`), which exposes every
-- tenant's rows to anyone with the publishable key. school_counters is worse
-- still: it holds counter_token, the credential that authorises calling —
-- leaking it is the precise bug migration 20260703_counter_presence.sql had to
-- fix on `counters`.
--
-- So school device surfaces stay on the service-role side of the fence:
--   * instant call/recall updates arrive over a Realtime *broadcast* topic
--     (`school-display-<branch>`), which carries only what the board renders;
--   * state of record is re-read through server actions that use the service
--     client, on a short poll that doubles as the recovery path for a TV whose
--     socket drops with nobody there to reload it.
-- Publishing these tables would add WAL overhead for a subscription nothing
-- can legitimately open.


-- ══════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- ── school_service_date ───────────────────────────────────────
-- The one place a school "day" is defined. Every token issue, board read,
-- dashboard tile and report must go through this — an RPC and a dashboard that
-- disagree by one day is the support ticket this product would otherwise
-- generate. Never derive the date in JS.
CREATE OR REPLACE FUNCTION public.school_service_date(p_branch_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    (now() AT TIME ZONE coalesce(s.timezone, 'Asia/Qatar'))
    - coalesce(s.day_start_time, '00:00'::time)::interval
  )::date
  FROM public.branches b
  LEFT JOIN public.school_settings s ON s.branch_id = b.id
  WHERE b.id = p_branch_id;
$$;


-- ── claim_school_token ────────────────────────────────────────
-- Issues the next token in a department's daily series.
--
-- The cursor bump is a single INSERT … ON CONFLICT DO UPDATE on purpose: the
-- one-row upsert holds the row lock until commit, so concurrent kiosks
-- serialize without an advisory lock. A select-then-update would be a TOCTOU
-- race. And because a plpgsql function is one transaction, a failed token
-- insert rolls the increment back — the series stays gapless.
CREATE OR REPLACE FUNCTION public.claim_school_token(
  p_branch_id     uuid,
  p_department_id uuid,
  p_source        text    DEFAULT 'kiosk',
  p_is_priority   boolean DEFAULT false
)
RETURNS public.school_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dept   public.school_departments;
  v_date   date;
  v_number int;
  v_token  public.school_tokens;
BEGIN
  SELECT * INTO v_dept
    FROM public.school_departments
   WHERE id = p_department_id AND branch_id = p_branch_id AND is_active;

  IF v_dept.id IS NULL THEN
    RAISE EXCEPTION 'Department % is not an active department of branch %',
      p_department_id, p_branch_id;
  END IF;

  v_date := public.school_service_date(p_branch_id);

  INSERT INTO public.school_department_days
    (customer_id, branch_id, department_id, service_date, next_number)
  VALUES
    (v_dept.customer_id, p_branch_id, p_department_id, v_date, v_dept.number_start + 1)
  ON CONFLICT (department_id, service_date) DO UPDATE
    SET next_number = school_department_days.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO public.school_tokens
    (customer_id, branch_id, department_id, service_date, number, token_code,
     is_priority, source)
  VALUES
    (v_dept.customer_id, p_branch_id, p_department_id, v_date, v_number,
     v_dept.prefix || v_number::text,
     p_is_priority OR v_dept.is_priority,
     p_source)
  RETURNING * INTO v_token;

  INSERT INTO public.school_activity_logs
    (customer_id, branch_id, token_id, department_id, source, type, token_code, message)
  VALUES
    (v_dept.customer_id, p_branch_id, v_token.id, p_department_id, p_source, 'issued',
     v_token.token_code, v_token.token_code || ' issued — ' || v_dept.name_en);

  RETURN v_token;
END;
$$;


-- ── call_next_school_token ────────────────────────────────────
-- Calls the next token this window should serve, and closes out whatever it
-- was serving.
--
-- Two counters on the same department would otherwise both select the same
-- oldest waiting row, so the pick is FOR UPDATE … SKIP LOCKED: the second
-- caller skips the locked row and takes the next one instead of blocking and
-- then acting on a row it already saw as `waiting`.
--
-- Ordering is a single effective-wait key rather than hard sort columns, so
-- neither the normal lane nor a secondary department can starve:
--   effective_joined_at = joined_at
--                       + preference * p_preference_penalty_minutes
--                       - p_priority_grace_minutes (priority tokens only)
-- A priority visitor jumps the queue, but only past people who have waited
-- less than the grace window.
CREATE OR REPLACE FUNCTION public.call_next_school_token(
  p_counter_id               uuid,
  p_priority_grace_minutes   int DEFAULT 10,
  p_preference_penalty_minutes int DEFAULT 3
)
RETURNS public.school_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter public.school_counters;
  v_date    date;
  v_id      uuid;
  v_token   public.school_tokens;
BEGIN
  SELECT * INTO v_counter
    FROM public.school_counters WHERE id = p_counter_id AND is_active;

  IF v_counter.id IS NULL THEN
    RAISE EXCEPTION 'Counter % not found or inactive', p_counter_id;
  END IF;

  v_date := public.school_service_date(v_counter.branch_id);

  SELECT t.id INTO v_id
    FROM public.school_tokens t
    JOIN public.school_counter_departments cd
      ON cd.department_id = t.department_id
     AND cd.counter_id = p_counter_id
   WHERE t.branch_id = v_counter.branch_id
     AND t.service_date = v_date
     AND t.status = 'waiting'
     AND (v_counter.accepts_priority OR NOT t.is_priority)
   ORDER BY
     t.joined_at
       + make_interval(mins => cd.preference * p_preference_penalty_minutes)
       - CASE WHEN t.is_priority
              THEN make_interval(mins => p_priority_grace_minutes)
              ELSE interval '0' END
   LIMIT 1
   FOR UPDATE OF t SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Close out the previous token first: the partial unique index allows only
  -- one 'called' row per counter.
  UPDATE public.school_tokens
     SET status = 'served', served_at = now()
   WHERE counter_id = p_counter_id AND status = 'called';

  UPDATE public.school_tokens
     SET status     = 'called',
         counter_id = p_counter_id,
         called_at  = now(),
         call_count = call_count + 1
   WHERE id = v_id
  RETURNING * INTO v_token;

  INSERT INTO public.school_activity_logs
    (customer_id, branch_id, token_id, counter_id, department_id,
     source, type, token_code, message)
  VALUES
    (v_token.customer_id, v_token.branch_id, v_token.id, p_counter_id,
     v_token.department_id, 'staff', 'called', v_token.token_code,
     v_token.token_code || ' called to ' || v_counter.name_en);

  RETURN v_token;
END;
$$;


-- ── get_school_board ──────────────────────────────────────────
-- Everything one TV needs, in one round trip.
--
-- The board is ONE ROW PER OPEN WINDOW, always visible, showing that window's
-- current token or nothing — not "the last N tokens called", which would make
-- a quiet counter vanish from the board a few calls later.
CREATE OR REPLACE FUNCTION public.get_school_board(p_screen_token text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_screen   public.screens;
  v_branch   public.branches;
  v_customer public.customers;
  v_settings public.school_settings;
  v_date     date;
  v_counters json;
  v_recent   json;
  v_depts    json;
  v_ads      json;
  v_tickers  json;
BEGIN
  SELECT * INTO v_screen
    FROM public.screens WHERE screen_token = p_screen_token AND is_active;

  IF v_screen.id IS NULL THEN
    RETURN json_build_object('status', 'not-found');
  END IF;

  -- Presence is deliberately NOT written here. This read is served from an
  -- in-process cache (lib/cache/store.ts) and usually never reaches Postgres,
  -- so it can no longer double as a heartbeat. The app writes screens.last_seen_at
  -- separately and throttled — lib/cache/presence.ts#touchScreen. That is also
  -- why the function is STABLE: it has no side effects.

  SELECT * INTO v_branch   FROM public.branches  WHERE id = v_screen.branch_id;
  SELECT * INTO v_customer FROM public.customers WHERE id = v_screen.customer_id;

  IF NOT v_customer.is_active
     OR (v_customer.plan_expires_at IS NOT NULL AND v_customer.plan_expires_at < now()) THEN
    RETURN json_build_object('status', 'expired');
  END IF;

  SELECT * INTO v_settings FROM public.school_settings WHERE branch_id = v_branch.id;
  v_date := public.school_service_date(v_branch.id);

  -- One row per window, with whatever it is currently calling.
  SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.display_order, r.name_en), '[]'::json)
    INTO v_counters
    FROM (
      SELECT c.id, c.name_en, c.name_ar, c.display_order, c.is_open, c.last_seen_at,
             t.id            AS token_id,
             t.token_code,
             t.called_at,
             t.recall_count,
             t.is_priority,
             d.name_en       AS department_en,
             d.name_ar       AS department_ar,
             d.color         AS department_color
        FROM public.school_counters c
        LEFT JOIN public.school_tokens t
               ON t.counter_id = c.id
              AND t.status = 'called'
              AND t.service_date = v_date
        LEFT JOIN public.school_departments d ON d.id = t.department_id
       WHERE c.branch_id = v_branch.id AND c.is_active
    ) r;

  SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.served_at DESC), '[]'::json)
    INTO v_recent
    FROM (
      SELECT t.token_code, t.served_at, c.name_en AS counter_en, c.name_ar AS counter_ar
        FROM public.school_tokens t
        LEFT JOIN public.school_counters c ON c.id = t.counter_id
       WHERE t.branch_id = v_branch.id
         AND t.service_date = v_date
         AND t.status = 'served'
       ORDER BY t.served_at DESC
       LIMIT 8
    ) r;

  SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.display_order), '[]'::json)
    INTO v_depts
    FROM (
      SELECT d.id, d.name_en, d.name_ar, d.color, d.display_order,
             count(t.id) FILTER (WHERE t.status = 'waiting') AS waiting
        FROM public.school_departments d
        LEFT JOIN public.school_tokens t
               ON t.department_id = d.id AND t.service_date = v_date
       WHERE d.branch_id = v_branch.id AND d.is_active
       GROUP BY d.id
    ) r;

  -- Ads: screen override wins, else branch + customer merged per branch_ad_mode.
  -- Same cascade as get_screen_data — kept in sync deliberately.
  -- Projected to the six fields the clients read (web SchoolBoard, Flutter
  -- BoardAd) rather than json_agg'ing whole rows: this packet is re-served on
  -- every poll and SSE frame, so file_size_bytes and timestamps are pure weight.
  DECLARE
    v_screen_ad_count int;
  BEGIN
    SELECT count(*) INTO v_screen_ad_count
      FROM public.screen_ads sa WHERE sa.screen_id = v_screen.id;

    IF v_screen_ad_count > 0 THEN
      SELECT json_agg(json_build_object(
                 'id', a.id, 'file_url', a.file_url, 'file_type', a.file_type,
                 'duration_seconds', a.duration_seconds, 'is_active', a.is_active,
                 'audio_enabled', a.audio_enabled) ORDER BY sa.display_order ASC) INTO v_ads
        FROM public.screen_ads sa
        JOIN public.ads a ON a.id = sa.ad_id
       WHERE sa.screen_id = v_screen.id AND a.is_active = true;
    ELSE
      DECLARE
        v_branch_ads   json;
        v_customer_ads json;
      BEGIN
        SELECT json_agg(json_build_object(
                 'id', a.id, 'file_url', a.file_url, 'file_type', a.file_type,
                 'duration_seconds', a.duration_seconds, 'is_active', a.is_active,
                 'audio_enabled', a.audio_enabled) ORDER BY a.display_order) INTO v_branch_ads
          FROM public.ads a WHERE a.branch_id = v_branch.id AND a.is_active = true;

        SELECT json_agg(json_build_object(
                 'id', a.id, 'file_url', a.file_url, 'file_type', a.file_type,
                 'duration_seconds', a.duration_seconds, 'is_active', a.is_active,
                 'audio_enabled', a.audio_enabled) ORDER BY a.display_order) INTO v_customer_ads
          FROM public.ads a
         WHERE a.customer_id = v_customer.id AND a.branch_id IS NULL AND a.is_active = true;

        IF v_branch_ads IS NULL THEN
          v_ads := v_customer_ads;
        ELSIF v_customer_ads IS NULL THEN
          v_ads := v_branch_ads;
        ELSE
          CASE v_customer.branch_ad_mode
            WHEN 'replace' THEN v_ads := v_branch_ads;
            WHEN 'prepend' THEN v_ads := (SELECT json_agg(x) FROM (SELECT * FROM json_array_elements(v_branch_ads) UNION ALL SELECT * FROM json_array_elements(v_customer_ads)) x);
            ELSE                v_ads := (SELECT json_agg(x) FROM (SELECT * FROM json_array_elements(v_customer_ads) UNION ALL SELECT * FROM json_array_elements(v_branch_ads)) x);
          END CASE;
        END IF;
      END;
    END IF;
  END;

  SELECT json_agg(json_build_object('id', t.id, 'message', t.message) ORDER BY t.display_order) INTO v_tickers
    FROM public.ticker_messages t
   WHERE t.is_active = true
     AND (t.branch_id = v_branch.id OR (t.branch_id IS NULL AND t.customer_id = v_customer.id));

  RETURN json_build_object(
    'status',      'ok',
    'screenId',    v_screen.id,
    'branchId',    v_branch.id,
    'customerId',  v_customer.id,
    'serviceDate', v_date,
    'schoolName',  coalesce(nullif(v_settings.school_name_en, ''), v_customer.business_name),
    'schoolNameAr', coalesce(v_settings.school_name_ar, ''),
    'logoUrl',     coalesce(nullif(v_settings.logo_url, ''), v_customer.logo_url),
    'primaryColor', v_customer.primary_color,
    'announcementLang', v_screen.announcement_lang,
    'announceEnabled',  coalesce(v_settings.announce_enabled, true),
    'announceTemplateEn', coalesce(v_settings.announce_template_en, 'Token {token}, please proceed to {counter}'),
    'announceTemplateAr', coalesce(v_settings.announce_template_ar, ''),
    'showClock',   v_screen.show_clock,
    'tickerText',  v_branch.ticker_text,
    'counters',    v_counters,
    'recent',      v_recent,
    'departments', v_depts,
    'ads',         coalesce(v_ads, '[]'::json),
    'tickers',     coalesce(v_tickers, '[]'::json)
  );
END;
$$;


-- The school RPCs are only ever called from server actions and the DAL, both
-- of which use the service-role client. Nothing here is reachable from a
-- browser session.
REVOKE ALL ON FUNCTION public.school_service_date(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_school_token(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.call_next_school_token(uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_school_board(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.school_service_date(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_school_token(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.call_next_school_token(uuid, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_school_board(text) TO service_role;
