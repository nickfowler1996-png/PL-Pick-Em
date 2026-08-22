-- ------------------------------------------------------------------
-- Reveal everyone's picks, but only once the matchweek has locked.
--
-- Enforced in Postgres rather than in the UI. Hiding other people's slips in
-- the front end would leave them readable through the API, and knowing what
-- the rest of the pool has done before the deadline is the one thing that
-- would actually break the game.
--
-- Postgres ORs permissive SELECT policies together, so this sits alongside the
-- existing "own picks only" rule: your own slip any time, everyone else's from
-- the first kick-off onward.
-- ------------------------------------------------------------------

create policy "all picks readable once locked" on picks
  for select using (
    exists (
      select 1
      from matches m
      join matchweeks mw on mw.id = m.matchweek_id
      where m.id = picks.match_id
        and now() >= mw.locks_at
    )
  );
