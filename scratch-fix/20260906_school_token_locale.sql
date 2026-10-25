-- ══════════════════════════════════════════════════════════════
-- Ticket locale: the language the visitor picked at the kiosk
-- ══════════════════════════════════════════════════════════════
-- The kiosk knows which language the visitor was reading when they took the
-- number. Persisting it on the token lets the public tracking page
-- (app/(public)/t/[code]) open in that same language instead of the branch's
-- base locale — the QR is scanned by the person who chose the language, so
-- the page should speak it.
--
-- Nullable, no default: a NULL locale (staff walk-in, an older kiosk build,
-- a hand-minted token) means "no preference" and the tracker falls back to
-- the branch base locale exactly as it did before this column existed. The
-- value is NOT validated against the branch's `languages` here — the client
-- picks from the enabled set and coerceLocales() on the read side drops
-- anything unusable.
--
-- NOT mirrored into supabase/schema.sql (its opening `drop table … cascade`
-- would orphan the school product); appended to supabase/setup-fresh-db.sql
-- instead.
-- ══════════════════════════════════════════════════════════════


-- ── 1. Column ──────────────────────────────────────────────────
ALTER TABLE public.school_tokens ADD COLUMN IF NOT EXISTS locale text;


-- ── 2. claim_school_token — carry the locale through ───────────
-- Signature changes (adds p_locale), so the old 4-arg function is dropped
-- rather than replaced. PostgREST callers pass args by name, so a call that
-- omits p_locale still resolves against the new default.
DROP FUNCTION IF EXISTS public.claim_school_token(uuid, uuid, text, boolean);

CREATE FUNCTION public.claim_school_token(
  p_branch_id     uuid,
  p_department_id uuid,
  p_source        text    DEFAULT 'kiosk',
  p_is_priority   boolean DEFAULT false,
  p_locale        text    DEFAULT NULL
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
     is_priority, source, locale)
  VALUES
    (v_dept.customer_id, p_branch_id, p_department_id, v_date, v_number,
     v_dept.prefix || v_number::text,
     p_is_priority OR v_dept.is_priority,
     p_source,
     nullif(p_locale, ''))
  RETURNING * INTO v_token;

  INSERT INTO public.school_activity_logs
    (customer_id, branch_id, token_id, department_id, source, type, token_code, message)
  VALUES
    (v_dept.customer_id, p_branch_id, v_token.id, p_department_id, p_source, 'issued',
     v_token.token_code, v_token.token_code || ' issued — ' || public.loc(v_dept.name, 'en'));

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_school_token(uuid, uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_school_token(uuid, uuid, text, boolean, text) TO service_role;


-- ── 3. get_public_ticket_status — emit the ticket locale ───────
-- Body identical to 20260904_school_content_locale_jsonb.sql plus the one new
-- 'locale' key. CREATE OR REPLACE (same signature) so grants carry over.
CREATE OR REPLACE FUNCTION public.get_public_ticket_status(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token          public.school_tokens;
  v_dept           public.school_departments;
  v_branch         public.branches;
  v_customer       public.customers;
  v_settings       public.school_settings;
  v_counter        public.school_counters;
  v_today          date;
  v_is_today       boolean;
  v_enabled        boolean;
  v_waiting_ahead  int;
  v_now_serving    text;
  v_pace_count     int;
  v_pace_min       timestamptz;
  v_pace_max       timestamptz;
  v_avg_gap_secs   numeric;
  v_eta_secs       numeric;
  v_school_name    text;
BEGIN
  SELECT * INTO v_token FROM public.school_tokens WHERE public_code = p_code;
  IF v_token.id IS NULL THEN
    RETURN json_build_object('status', 'not-found');
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = v_token.customer_id;
  SELECT * INTO v_branch   FROM public.branches  WHERE id = v_token.branch_id;
  SELECT * INTO v_settings FROM public.school_settings WHERE branch_id = v_token.branch_id;
  SELECT * INTO v_dept     FROM public.school_departments WHERE id = v_token.department_id;

  IF NOT v_customer.is_active
     OR (v_customer.plan_expires_at IS NOT NULL AND v_customer.plan_expires_at < now()) THEN
    RETURN json_build_object('status', 'expired');
  END IF;

  v_enabled := coalesce(v_customer.school_public_tracking_enabled, false)
           AND coalesce(v_settings.public_tracking_enabled, true);

  IF NOT v_enabled THEN
    RETURN json_build_object('status', 'disabled');
  END IF;

  v_today    := public.school_service_date(v_token.branch_id);
  v_is_today := (v_token.service_date = v_today);

  SELECT count(*) INTO v_waiting_ahead
    FROM public.school_tokens
   WHERE branch_id = v_token.branch_id
     AND department_id = v_token.department_id
     AND service_date = v_token.service_date
     AND status IN ('waiting', 'held')
     AND joined_at < v_token.joined_at;

  IF v_token.counter_id IS NOT NULL AND v_token.status = 'called' THEN
    SELECT * INTO v_counter FROM public.school_counters WHERE id = v_token.counter_id;
  END IF;

  SELECT token_code INTO v_now_serving
    FROM public.school_tokens
   WHERE department_id = v_token.department_id
     AND service_date = v_token.service_date
     AND status = 'called'
   ORDER BY called_at DESC
   LIMIT 1;

  SELECT count(*), min(called_at), max(called_at)
    INTO v_pace_count, v_pace_min, v_pace_max
    FROM (
      SELECT called_at FROM public.school_tokens
       WHERE department_id = v_token.department_id
         AND service_date = v_token.service_date
         AND called_at IS NOT NULL
       ORDER BY called_at DESC
       LIMIT 10
    ) recent;

  IF v_pace_count >= 3 AND v_pace_max > v_pace_min THEN
    v_avg_gap_secs := extract(epoch FROM (v_pace_max - v_pace_min)) / (v_pace_count - 1);
  ELSE
    v_avg_gap_secs := coalesce(v_branch.avg_service_time, 5) * 60;
  END IF;

  v_eta_secs := v_waiting_ahead * v_avg_gap_secs;

  v_school_name := coalesce(nullif(public.loc(v_settings.school_name, 'en'), ''), v_customer.business_name);

  RETURN json_build_object(
    'status',            'ok',
    'schoolNameEn',      v_school_name,
    'schoolNameAr',      public.loc(v_settings.school_name, 'ar'),
    'schoolName',
        coalesce(v_settings.school_name, '{}'::jsonb)
        || jsonb_build_object('en', v_school_name),
    'logoUrl',           coalesce(nullif(v_settings.logo_url, ''), v_customer.logo_url),
    'languages',         coalesce(v_settings.languages, ARRAY['en']),
    'locale',            v_token.locale,
    'tokenCode',         v_token.token_code,
    'tokenStatus',       v_token.status,
    'isPriority',        v_token.is_priority,
    'joinedAt',          v_token.joined_at,
    'calledAt',          v_token.called_at,
    'departmentNameEn',  public.loc(v_dept.name, 'en'),
    'departmentNameAr',  public.loc(v_dept.name, 'ar'),
    'departmentName',    coalesce(v_dept.name, '{}'::jsonb),
    'counterNameEn',     public.loc(v_counter.name, 'en'),
    'counterNameAr',     public.loc(v_counter.name, 'ar'),
    'counterName',       coalesce(v_counter.name, '{}'::jsonb),
    'serviceDate',       v_token.service_date,
    'isToday',           v_is_today,
    'waitingAhead',      v_waiting_ahead,
    'nowServingCode',    v_now_serving,
    'etaSeconds',        round(v_eta_secs),
    'paceSampleCount',   v_pace_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_ticket_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_ticket_status(text) TO service_role;
