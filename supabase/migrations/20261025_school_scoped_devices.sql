-- ══════════════════════════════════════════════════════════════
-- School: per-department / per-counter kiosks and calling displays
-- ══════════════════════════════════════════════════════════════
-- Until now a school branch had exactly one kiosk (addressed by the branch's
-- own token, offering every department) and its TV boards each showed every
-- counter. A school with an Admissions wing and a Fees wing wants a kiosk and
-- a calling display *per desk*:
--
--   * a DISPLAY can be scoped to a set of departments and/or counters — it
--     then lists only those windows, announces only their calls and counts
--     only their queues;
--   * a KIOSK can be scoped to a set of departments, or DEDICATED to one
--     counter: it offers that counter's departments and pins every token it
--     issues to that counter, so a visitor who took a ticket at Desk 3's
--     kiosk is only ever called by Desk 3.
--
-- Nothing here changes existing devices. A screen with no scope rows, and the
-- branch-token kiosk, behave exactly as before ("everything").
--
-- Requires 20260904_school_content_locale_jsonb.sql (public.loc, jsonb names)
-- and 20260906_school_token_locale.sql (school_tokens.locale) to have run.
--
-- NOT mirrored into supabase/schema.sql — same reason as the other school
-- migrations (its opening `drop table … cascade` would orphan these tables).
-- ══════════════════════════════════════════════════════════════


-- ── 1. Token pinned to a counter ──────────────────────────────
-- Distinct from counter_id, which means "the window that called it".
-- target_counter_id means "only this window may call it"; NULL = any window
-- serving the department (the old behaviour). ON DELETE SET NULL: if a
-- counter ever is hard-deleted its queue falls back into the shared pool
-- rather than stranding.
ALTER TABLE public.school_tokens
  ADD COLUMN IF NOT EXISTS target_counter_id uuid
    REFERENCES public.school_counters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS school_tokens_target_counter_idx
  ON public.school_tokens(target_counter_id)
  WHERE target_counter_id IS NOT NULL AND status IN ('waiting', 'held');


-- ── 2. Kiosks ─────────────────────────────────────────────────
-- The branch-token kiosk keeps working and is not a row here. A row is an
-- ADDITIONAL, individually addressed kiosk with its own token (so it can be
-- revoked on its own) and its own scope.
CREATE TABLE IF NOT EXISTS public.school_kiosks (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  name          text not null,
  kiosk_token   text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Set = a dedicated desk kiosk: offers this counter's departments, pins tokens to it.
  counter_id    uuid references public.school_counters(id) on delete cascade,
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS school_kiosks_branch_idx ON public.school_kiosks(branch_id);

-- Departments a non-dedicated kiosk offers. Empty (and counter_id null) = all.
CREATE TABLE IF NOT EXISTS public.school_kiosk_departments (
  kiosk_id      uuid not null references public.school_kiosks(id) on delete cascade,
  department_id uuid not null references public.school_departments(id) on delete cascade,
  primary key (kiosk_id, department_id)
);


-- ── 3. Display scope ──────────────────────────────────────────
-- Both empty = the screen shows the whole branch, as before. Otherwise the
-- screen's counters are the explicitly listed ones plus every counter that
-- serves a listed department.
CREATE TABLE IF NOT EXISTS public.school_screen_departments (
  screen_id     uuid not null references public.screens(id) on delete cascade,
  department_id uuid not null references public.school_departments(id) on delete cascade,
  primary key (screen_id, department_id)
);

CREATE TABLE IF NOT EXISTS public.school_screen_counters (
  screen_id  uuid not null references public.screens(id) on delete cascade,
  counter_id uuid not null references public.school_counters(id) on delete cascade,
  primary key (screen_id, counter_id)
);

CREATE INDEX IF NOT EXISTS school_screen_departments_dept_idx
  ON public.school_screen_departments(department_id);
CREATE INDEX IF NOT EXISTS school_screen_counters_counter_idx
  ON public.school_screen_counters(counter_id);


-- ── 4. Pairing codes can target a scoped kiosk ────────────────
ALTER TABLE public.device_pairing_codes
  ADD COLUMN IF NOT EXISTS kiosk_id uuid REFERENCES public.school_kiosks(id) ON DELETE CASCADE;


-- ── RLS — service role only ───────────────────────────────────
-- school_kiosks holds kiosk_token, a credential; same rule as counter_token.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'school_kiosks', 'school_kiosk_departments',
    'school_screen_departments', 'school_screen_counters'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_only', t);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- ── claim_school_token — optional target counter ──────────────
-- Signature changes (adds p_target_counter_id), so the 5-arg function is
-- dropped rather than replaced. PostgREST callers pass args by name, so every
-- existing call that omits it still resolves against the new default.
DROP FUNCTION IF EXISTS public.claim_school_token(uuid, uuid, text, boolean, text);

CREATE FUNCTION public.claim_school_token(
  p_branch_id         uuid,
  p_department_id     uuid,
  p_source            text    DEFAULT 'kiosk',
  p_is_priority       boolean DEFAULT false,
  p_locale            text    DEFAULT NULL,
  p_target_counter_id uuid    DEFAULT NULL
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

  -- A pin to a counter that is gone, inactive, or in another branch would
  -- strand the ticket forever. Fail loudly instead of issuing it.
  IF p_target_counter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.school_counters
     WHERE id = p_target_counter_id AND branch_id = p_branch_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Counter % is not an active counter of branch %',
      p_target_counter_id, p_branch_id;
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
     is_priority, source, locale, target_counter_id)
  VALUES
    (v_dept.customer_id, p_branch_id, p_department_id, v_date, v_number,
     v_dept.prefix || v_number::text,
     p_is_priority OR v_dept.is_priority,
     p_source,
     nullif(p_locale, ''),
     p_target_counter_id)
  RETURNING * INTO v_token;

  INSERT INTO public.school_activity_logs
    (customer_id, branch_id, token_id, department_id, source, type, token_code, message)
  VALUES
    (v_dept.customer_id, p_branch_id, v_token.id, p_department_id, p_source, 'issued',
     v_token.token_code, v_token.token_code || ' issued — ' || public.loc(v_dept.name, 'en'));

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_school_token(uuid, uuid, text, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_school_token(uuid, uuid, text, boolean, text, uuid) TO service_role;


-- ── call_next_school_token — respect the pin ──────────────────
-- Identical to 20260904_school_content_locale_jsonb.sql plus one predicate: a
-- token pinned to another counter is invisible to this one.
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
     AND (t.target_counter_id IS NULL OR t.target_counter_id = p_counter_id)
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
     v_token.token_code || ' called to ' || public.loc(v_counter.name, 'en'));

  RETURN v_token;
END;
$$;


-- ── get_school_board — honour the screen's scope ──────────────
-- Identical to 20260904_school_content_locale_jsonb.sql except:
--   * counters / recent / departments are filtered to the screen's scope;
--   * the packet gains `scoped` and `screenName`.
-- A screen with no scope rows takes the unscoped path in every query, so an
-- existing board renders byte-for-byte what it did before.
CREATE OR REPLACE FUNCTION public.get_school_board(p_screen_token text)
RETURNS json
LANGUAGE plpgsql
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
  v_scoped         boolean;
  v_scope_counters uuid[] := '{}';
  v_scope_depts    uuid[] := '{}';
BEGIN
  SELECT * INTO v_screen
    FROM public.screens WHERE screen_token = p_screen_token AND is_active;

  IF v_screen.id IS NULL THEN
    RETURN json_build_object('status', 'not-found');
  END IF;

  UPDATE public.screens SET last_seen_at = now() WHERE id = v_screen.id;

  SELECT * INTO v_branch   FROM public.branches  WHERE id = v_screen.branch_id;
  SELECT * INTO v_customer FROM public.customers WHERE id = v_screen.customer_id;

  IF NOT v_customer.is_active
     OR (v_customer.plan_expires_at IS NOT NULL AND v_customer.plan_expires_at < now()) THEN
    RETURN json_build_object('status', 'expired');
  END IF;

  SELECT * INTO v_settings FROM public.school_settings WHERE branch_id = v_branch.id;
  v_date := public.school_service_date(v_branch.id);

  -- ── Scope ──
  v_scoped :=
    EXISTS (SELECT 1 FROM public.school_screen_departments WHERE screen_id = v_screen.id)
    OR EXISTS (SELECT 1 FROM public.school_screen_counters WHERE screen_id = v_screen.id);

  IF v_scoped THEN
    SELECT coalesce(array_agg(DISTINCT c.id), '{}') INTO v_scope_counters
      FROM public.school_counters c
     WHERE c.branch_id = v_branch.id AND c.is_active
       AND (
         c.id IN (SELECT counter_id FROM public.school_screen_counters
                   WHERE screen_id = v_screen.id)
         OR c.id IN (SELECT cd.counter_id
                       FROM public.school_counter_departments cd
                       JOIN public.school_screen_departments sd
                         ON sd.department_id = cd.department_id
                      WHERE sd.screen_id = v_screen.id)
       );

    -- Departments shown in the footer strip: the ones listed outright, plus
    -- whatever the explicitly listed counters serve.
    SELECT coalesce(array_agg(DISTINCT x.department_id), '{}') INTO v_scope_depts
      FROM (
        SELECT department_id FROM public.school_screen_departments
         WHERE screen_id = v_screen.id
        UNION
        SELECT cd.department_id
          FROM public.school_counter_departments cd
          JOIN public.school_screen_counters sc ON sc.counter_id = cd.counter_id
         WHERE sc.screen_id = v_screen.id
      ) x;
  END IF;

  SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.display_order, r.name_en), '[]'::json)
    INTO v_counters
    FROM (
      SELECT c.id,
             c.name       AS name,
             c.name_en, c.name_ar,
             c.display_order, c.is_open, c.last_seen_at,
             t.id            AS token_id,
             t.token_code,
             t.called_at,
             t.recall_count,
             t.is_priority,
             d.name          AS department,
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
         AND (NOT v_scoped OR c.id = ANY (v_scope_counters))
    ) r;

  SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.served_at DESC), '[]'::json)
    INTO v_recent
    FROM (
      SELECT t.token_code, t.served_at,
             c.name    AS counter,
             c.name_en AS counter_en,
             c.name_ar AS counter_ar
        FROM public.school_tokens t
        LEFT JOIN public.school_counters c ON c.id = t.counter_id
       WHERE t.branch_id = v_branch.id
         AND t.service_date = v_date
         AND t.status = 'served'
         AND (NOT v_scoped OR t.counter_id = ANY (v_scope_counters))
       ORDER BY t.served_at DESC
       LIMIT 8
    ) r;

  SELECT coalesce(json_agg(row_to_json(r) ORDER BY r.display_order), '[]'::json)
    INTO v_depts
    FROM (
      SELECT d.id,
             d.name    AS name,
             d.name_en, d.name_ar,
             d.color, d.display_order,
             count(t.id) FILTER (WHERE t.status = 'waiting') AS waiting
        FROM public.school_departments d
        LEFT JOIN public.school_tokens t
               ON t.department_id = d.id AND t.service_date = v_date
       WHERE d.branch_id = v_branch.id AND d.is_active
         AND (NOT v_scoped OR d.id = ANY (v_scope_depts))
       GROUP BY d.id
    ) r;

  DECLARE
    v_screen_ad_count int;
  BEGIN
    SELECT count(*) INTO v_screen_ad_count
      FROM public.screen_ads sa WHERE sa.screen_id = v_screen.id;

    IF v_screen_ad_count > 0 THEN
      SELECT json_agg(a ORDER BY sa.display_order ASC) INTO v_ads
        FROM public.screen_ads sa
        JOIN public.ads a ON a.id = sa.ad_id
       WHERE sa.screen_id = v_screen.id AND a.is_active = true;
    ELSE
      DECLARE
        v_branch_ads   json;
        v_customer_ads json;
      BEGIN
        SELECT json_agg(a ORDER BY a.display_order) INTO v_branch_ads
          FROM public.ads a WHERE a.branch_id = v_branch.id AND a.is_active = true;

        SELECT json_agg(a ORDER BY a.display_order) INTO v_customer_ads
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

  SELECT json_agg(t ORDER BY t.display_order) INTO v_tickers
    FROM public.ticker_messages t
   WHERE t.is_active = true
     AND (t.branch_id = v_branch.id OR (t.branch_id IS NULL AND t.customer_id = v_customer.id));

  RETURN json_build_object(
    'status',      'ok',
    'screenId',    v_screen.id,
    'screenName',  v_screen.name,
    'scoped',      v_scoped,
    'branchId',    v_branch.id,
    'customerId',  v_customer.id,
    'serviceDate', v_date,
    'schoolName',  coalesce(nullif(public.loc(v_settings.school_name, 'en'), ''), v_customer.business_name),
    'schoolNameAr', public.loc(v_settings.school_name, 'ar'),
    'schoolNameI18n',
        coalesce(v_settings.school_name, '{}'::jsonb)
        || jsonb_build_object('en', coalesce(nullif(public.loc(v_settings.school_name, 'en'), ''), v_customer.business_name)),
    'logoUrl',     coalesce(nullif(v_settings.logo_url, ''), v_customer.logo_url),
    'primaryColor', v_customer.primary_color,
    'announcementLang', v_screen.announcement_lang,
    'announceLocales', coalesce(v_settings.languages, ARRAY['en']),
    'announceEnabled',  coalesce(v_settings.announce_enabled, true),
    'announceTemplateEn', coalesce(nullif(public.loc(v_settings.announce_template, 'en'), ''), 'Token {token}, please proceed to {counter}'),
    'announceTemplateAr', public.loc(v_settings.announce_template, 'ar'),
    'announceTemplateI18n',
        coalesce(v_settings.announce_template, '{}'::jsonb)
        || jsonb_build_object('en', coalesce(nullif(public.loc(v_settings.announce_template, 'en'), ''), 'Token {token}, please proceed to {counter}')),
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

REVOKE ALL ON FUNCTION public.get_school_board(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_school_board(text) TO service_role;
