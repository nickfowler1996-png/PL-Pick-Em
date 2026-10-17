-- ------------------------------------------------------------------
-- 1. Lock each match at its own kick-off, not the whole round at once.
-- 2. Reveal each match's picks at its own kick-off too.
-- 3. A helper for entering picks by hand.
--
-- Run this whole file once.
-- ------------------------------------------------------------------


-- ---- 1. Per-match lock --------------------------------------------
--
-- The round-wide deadline is gone: a Monday night fixture stays open until
-- Monday night. A session flag lets an admin write a late pick deliberately
-- (see add_pick below); normal writes from the app can never set it.

create or replace function enforce_pick_lock() returns trigger as $$
declare
  kick_time timestamptz;
begin
  if coalesce(current_setting('pickem.bypass_lock', true), 'off') = 'on' then
    return new;
  end if;

  select m.kickoff into kick_time
    from matches m
   where m.id = new.match_id;

  if kick_time is null then
    raise exception 'Unknown match';
  end if;

  if now() >= kick_time then
    raise exception 'That match kicked off at % — picks are closed', kick_time;
  end if;

  return new;
end;
$$ language plpgsql;


-- ---- 2. Per-match reveal ------------------------------------------
--
-- Previously everyone's slip opened up when the round locked. With per-match
-- deadlines that would leak: someone yet to pick Monday's game could see what
-- the rest of the pool did with it. Now a match reveals at its own kick-off.

drop policy if exists "all picks readable once locked" on picks;

create policy "picks readable once the match kicks off" on picks
  for select using (
    exists (
      select 1 from matches m
      where m.id = picks.match_id
        and now() >= m.kickoff
    )
  );


-- ---- 3. Entering a pick by hand -----------------------------------
--
-- Writes a pick regardless of kick-off, pricing it from the last stored
-- snapshot. Use for a genuine exception, not routine lateness.
--
--   select add_pick('someone@email.com', 5, 'Arsenal', 'HOME', 1);
--
-- Identify the match by either club name. outcome is HOME, DRAW or AWAY.

create or replace function add_pick(
  p_email      text,
  p_matchweek  int,
  p_team       text,
  p_outcome    outcome,
  p_multiplier int default 1
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player uuid;
  v_match  uuid;
  v_price  int;
  v_desc   text;
begin
  select id into v_player from players where lower(email) = lower(p_email);
  if v_player is null then
    return format('No player with email %s', p_email);
  end if;

  select m.id, m.home_team || ' v ' || m.away_team
    into v_match, v_desc
    from matches m
    join matchweeks mw on mw.id = m.matchweek_id
   where mw.mw_number = p_matchweek
     and (m.home_team ilike '%' || p_team || '%'
       or m.away_team ilike '%' || p_team || '%');

  if v_match is null then
    return format('No single match in matchweek %s matching "%s"', p_matchweek, p_team);
  end if;

  select american into v_price
    from odds_snapshots
   where match_id = v_match and outcome = p_outcome
   order by fetched_at desc
   limit 1;

  if v_price is null then
    return format('No stored price for %s on %s', p_outcome, v_desc);
  end if;

  perform set_config('pickem.bypass_lock', 'on', true);

  insert into picks (player_id, match_id, outcome, multiplier, price_taken)
  values (v_player, v_match, p_outcome, p_multiplier, v_price)
  on conflict (player_id, match_id) do update
    set outcome = excluded.outcome,
        multiplier = excluded.multiplier,
        price_taken = excluded.price_taken,
        picked_at = now();

  perform set_config('pickem.bypass_lock', 'off', true);

  return format('%s: %s at %s (%sx)', v_desc, p_outcome, v_price, p_multiplier);
end;
$$;
