-- Premier League Pick 'em — Postgres / Supabase schema

create type outcome as enum ('HOME', 'DRAW', 'AWAY');
create type match_status as enum ('SCHEDULED', 'IN_PLAY', 'FINISHED', 'POSTPONED');
create type send_mode as enum ('standard', 'compressed');

create table players (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  display_name  text not null,
  active        boolean not null default true,
  joined_at     timestamptz not null default now()
);

create table matchweeks (
  id              uuid primary key default gen_random_uuid(),
  season          text not null,                    -- '2026/27'
  mw_number       int  not null check (mw_number between 1 and 38),
  quarter         int  not null check (quarter between 1 and 4),
  first_kickoff   timestamptz not null,
  last_kickoff    timestamptz not null,
  send_at         timestamptz not null,
  send_mode       send_mode   not null,
  invite_sent_at  timestamptz,
  reminder_sent_at timestamptz,
  -- Picks close here, same instant for everyone. Equals first_kickoff.
  locks_at        timestamptz not null,
  settled_at      timestamptz,
  unique (season, mw_number)
);

create table matches (
  id            uuid primary key default gen_random_uuid(),
  matchweek_id  uuid not null references matchweeks(id) on delete cascade,
  fd_match_id   bigint unique not null,             -- football-data.org id
  odds_event_id text,                               -- The Odds API event id
  home_team     text not null,
  away_team     text not null,
  kickoff       timestamptz not null,
  home_score    int,
  away_score    int,
  status        match_status not null default 'SCHEDULED',
  result        outcome,                            -- null until FINISHED
  -- Postponed and not replayed inside this matchweek. Voided fixtures score
  -- nothing for anyone, and any triple or quad staked on them is refunded.
  voided        boolean not null default false
);

create index on matches (matchweek_id);

-- Rolling cache of the live feed. Read the newest row per (match, outcome).
create table odds_snapshots (
  id          bigserial primary key,
  match_id    uuid not null references matches(id) on delete cascade,
  outcome     outcome not null,
  american    int not null,
  fetched_at  timestamptz not null default now()
);

create index on odds_snapshots (match_id, outcome, fetched_at desc);

create table picks (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players(id) on delete cascade,
  match_id      uuid not null references matches(id) on delete cascade,
  outcome       outcome not null,
  multiplier    int not null default 1 check (multiplier in (1,2,3,4)),
  -- The price the player took, stamped at tap time. Settlement reads THIS,
  -- never a later odds lookup.
  price_taken   int not null,
  picked_at     timestamptz not null default now(),
  settled_amount numeric(10,2),
  unique (player_id, match_id)
);

create index on picks (player_id);
create index on picks (match_id);

-- One row per player per matchweek, written by the settlement job.
-- Players who submitted nothing still get a row: -100 x number of matches.
create table matchweek_results (
  player_id     uuid not null references players(id) on delete cascade,
  matchweek_id  uuid not null references matchweeks(id) on delete cascade,
  total         numeric(10,2) not null,
  missed_matches int not null default 0,
  voided_matches int not null default 0,
  primary key (player_id, matchweek_id)
);

-- Reject picks submitted after the matchweek locks.
create or replace function enforce_pick_lock() returns trigger as $$
declare
  lock_time timestamptz;
begin
  select mw.locks_at into lock_time
    from matches m join matchweeks mw on mw.id = m.matchweek_id
   where m.id = new.match_id;

  if now() >= lock_time then
    raise exception 'Matchweek is locked — picks closed at %', lock_time;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger picks_lock_guard
  before insert or update on picks
  for each row execute function enforce_pick_lock();

-- Leaderboard. Quarter and season are both derived from the same rows;
-- the season column simply never filters by quarter.
create or replace view standings
with (security_invoker = on) as
select
  p.id            as player_id,
  p.display_name,
  mw.season,
  mw.quarter,
  sum(r.total)                                          as quarter_total,
  sum(sum(r.total)) over (partition by p.id, mw.season)  as season_total
from players p
join matchweek_results r on r.player_id = p.id
join matchweeks mw       on mw.id = r.matchweek_id
group by p.id, p.display_name, mw.season, mw.quarter;

-- Scarce multipliers actually spent: a pick on a voided fixture doesn't count,
-- which is what hands a player their triple or quad back.
create or replace view multiplier_usage as
select
  pk.player_id,
  mw.season,
  mw.quarter,
  count(*) filter (where pk.multiplier = 3 and not m.voided) as triples_used_in_quarter,
  count(*) filter (where pk.multiplier = 4 and not m.voided) as quads_used_in_season
from picks pk
join matches m     on m.id = pk.match_id
join matchweeks mw on mw.id = m.matchweek_id
group by pk.player_id, mw.season, mw.quarter;

-- ------------------------------------------------------------------
-- Row Level Security
--
-- Every table is locked down. The Data API exposes anything in the public
-- schema to anyone holding the anon key, so a table without RLS is a table
-- the world can write to. Cron jobs use the service_role key, which bypasses
-- RLS entirely, so nothing below affects them.
-- ------------------------------------------------------------------

alter table players            enable row level security;
alter table matchweeks         enable row level security;
alter table matches            enable row level security;
alter table odds_snapshots     enable row level security;
alter table picks              enable row level security;
alter table matchweek_results  enable row level security;

-- Reference data: players can read it, nobody can write it. Writes happen
-- through the service_role key in the cron jobs.
create policy "fixtures readable" on matchweeks
  for select using (auth.role() = 'authenticated');

create policy "matches readable" on matches
  for select using (auth.role() = 'authenticated');

create policy "odds readable" on odds_snapshots
  for select using (auth.role() = 'authenticated');

-- Names are needed to render the leaderboard, so the pool can see the roster.
create policy "roster readable" on players
  for select using (auth.role() = 'authenticated');

-- You can only touch your own picks, and you can't read anyone else's --
-- seeing another player's slip before kickoff would be cheating.
create policy "own picks only" on picks
  for all using (player_id = auth.uid()) with check (player_id = auth.uid());

-- Settled results are the leaderboard, so everyone sees everyone.
create policy "results readable" on matchweek_results
  for select using (auth.role() = 'authenticated');

-- Live leaderboard: push changes to connected clients as settlement writes.
alter publication supabase_realtime add table matchweek_results;
alter publication supabase_realtime add table matches;
