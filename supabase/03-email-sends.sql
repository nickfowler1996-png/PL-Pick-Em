-- ------------------------------------------------------------------
-- Per-player email log.
--
-- Sends were previously tracked once per matchweek, so anyone who joined
-- after a send had gone out missed it entirely — exactly what happens while
-- a pool is still filling up. Tracking per player instead means a new
-- sign-up receives whatever they haven't had yet.
-- ------------------------------------------------------------------

create type email_kind as enum ('invite', 'reminder', 'recap');

create table if not exists email_sends (
  player_id     uuid not null references players(id) on delete cascade,
  matchweek_id  uuid not null references matchweeks(id) on delete cascade,
  kind          email_kind not null,
  sent_at       timestamptz not null default now(),
  primary key (player_id, matchweek_id, kind)
);

create index if not exists email_sends_matchweek on email_sends (matchweek_id, kind);

alter table email_sends enable row level security;

create policy "own email log readable" on email_sends
  for select using (player_id = auth.uid());
