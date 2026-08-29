-- ------------------------------------------------------------------
-- Safety net for manually reopening a matchweek.
--
-- Normally every match locks together at the first kick-off, so a per-match
-- guard never binds. It only matters when the deadline is pushed back by
-- hand: without it, reopening a round would let someone pick a match that has
-- already been played.
--
-- This replaces the original trigger function. Run it once; it's permanent
-- and changes nothing about normal operation.
-- ------------------------------------------------------------------

create or replace function enforce_pick_lock() returns trigger as $$
declare
  lock_time timestamptz;
  kick_time timestamptz;
begin
  select mw.locks_at, m.kickoff
    into lock_time, kick_time
    from matches m
    join matchweeks mw on mw.id = m.matchweek_id
   where m.id = new.match_id;

  if now() >= lock_time then
    raise exception 'Matchweek is locked — picks closed at %', lock_time;
  end if;

  -- Belt and braces: never accept a pick on a match that has kicked off,
  -- whatever the matchweek deadline currently says.
  if now() >= kick_time then
    raise exception 'That match has already kicked off';
  end if;

  return new;
end;
$$ language plpgsql;
