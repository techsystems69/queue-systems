-- Web Push for school calling stations and for managers.
--
-- Builds on 20261026_counter_push_notifications.sql (push_config, pg_net, the
-- /api/push/notify route). Adds:
--   1. school_counter_push_subscriptions — a browser opted in on a school
--      calling station (/school/counter/<token>).
--   2. manager_push_subscriptions — a signed-in manager's browser, opted in
--      from the bell in the manager top bar. Scoped to the whole customer, so a
--      manager hears about every branch they run.
--   3. A trigger on school_tokens that POSTs the token id to the same
--      notify_url whenever a token starts waiting — a new token, a transfer into
--      another department, or a held token returned to the queue. The route
--      re-reads the token and decides who, if anyone, to notify.
--
-- Requires the school migrations (school_tokens, school_counters,
-- school_counter_departments) and 20261026_counter_push_notifications.sql.
-- No new push_config rows: the school trigger reuses notify_url/webhook_secret.

create table if not exists school_counter_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  counter_id  uuid not null references school_counters(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists school_counter_push_subscriptions_counter_idx
  on school_counter_push_subscriptions(counter_id);

create table if not exists manager_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists manager_push_subscriptions_customer_idx
  on manager_push_subscriptions(customer_id);

-- RLS on with no policies: only the service role (server actions + notify
-- route) can touch these. Endpoints and keys are secrets.
alter table school_counter_push_subscriptions enable row level security;
alter table manager_push_subscriptions enable row level security;

create or replace function notify_school_token_push() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from push_config where key = 'notify_url';
  select value into v_secret from push_config where key = 'webhook_secret';

  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body := jsonb_build_object('school_token_id', new.id),
    timeout_milliseconds := 3000
  );
  return new;
exception when others then
  -- A notification failure must never block a token from being issued.
  return new;
end;
$$;

revoke all on function notify_school_token_push() from public, anon, authenticated;

drop trigger if exists trg_push_school_token_new on school_tokens;
create trigger trg_push_school_token_new
  after insert on school_tokens
  for each row
  when (new.status = 'waiting')
  execute function notify_school_token_push();

drop trigger if exists trg_push_school_token_waiting on school_tokens;
create trigger trg_push_school_token_waiting
  after update of status, department_id on school_tokens
  for each row
  when (
    new.status = 'waiting'
    and (old.status is distinct from new.status or old.department_id is distinct from new.department_id)
  )
  execute function notify_school_token_push();
