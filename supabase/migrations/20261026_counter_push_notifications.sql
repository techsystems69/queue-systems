-- Web Push for counter terminals.
--
-- Counters (kitchen / billing / delivery) are paged even when the tablet's
-- browser is closed or the screen is off. Three pieces:
--   1. counter_push_subscriptions — one row per browser that opted in on a
--      counter page (endpoint + keys are secrets; service role only).
--   2. push_config — where the trigger should POST (notify_url) and the shared
--      secret it sends (webhook_secret). Kept in a table, not in this file, so
--      no secret lives in git and each database (urzl / india) points at its
--      own deployment. Service role only.
--   3. A trigger on queue_entries that POSTs the entry id to that URL through
--      pg_net whenever an order becomes actionable. Doing this in the database
--      covers every write path (counters, kiosk, public join, bulk releases)
--      instead of only the server actions we remembered to patch. The route
--      re-reads the entry and decides who, if anyone, to notify.
--
-- After running this, set the two config rows (see the bottom of this file).

create extension if not exists pg_net;

create table if not exists counter_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  counter_id  uuid not null references counters(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists counter_push_subscriptions_counter_idx
  on counter_push_subscriptions(counter_id);

-- RLS on with no policies: anon/authenticated can't read or write; the service
-- role (used by the server action and notify route) bypasses RLS.
alter table counter_push_subscriptions enable row level security;

create table if not exists push_config (
  key    text primary key,
  value  text not null
);

alter table push_config enable row level security;

create or replace function notify_counter_push() returns trigger
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

  -- Not configured yet (or deliberately off): do nothing.
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    body := jsonb_build_object('entry_id', new.id, 'branch_id', new.branch_id),
    timeout_milliseconds := 3000
  );
  return new;
exception when others then
  -- A notification failure must never block an order from being created.
  return new;
end;
$$;

revoke all on function notify_counter_push() from public, anon, authenticated;

drop trigger if exists trg_push_new_entry on queue_entries;
create trigger trg_push_new_entry
  after insert on queue_entries
  for each row
  when (new.status = 'waiting' and new.kitchen_status in ('pending', 'ready'))
  execute function notify_counter_push();

drop trigger if exists trg_push_entry_actionable on queue_entries;
create trigger trg_push_entry_actionable
  after update of status, kitchen_status on queue_entries
  for each row
  when (
    new.status = 'waiting'
    and new.kitchen_status in ('pending', 'ready')
    and (old.kitchen_status is distinct from new.kitchen_status or old.status is distinct from new.status)
  )
  execute function notify_counter_push();

-- Per-database setup, run once after this migration (values are examples):
--
--   insert into push_config (key, value) values
--     ('notify_url',     'https://YOUR-DEPLOYMENT/api/push/notify'),
--     ('webhook_secret', '<same value as the PUSH_WEBHOOK_SECRET env var>')
--   on conflict (key) do update set value = excluded.value;
--
-- To switch pushes off without dropping anything:
--   delete from push_config where key in ('notify_url', 'webhook_secret');
