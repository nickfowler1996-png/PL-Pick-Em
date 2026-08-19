-- ------------------------------------------------------------------
-- Link sign-ins to players.
--
-- A player's row must share its id with their Supabase auth account.
-- Picks are stored against auth.uid(), so a players row with a freshly
-- generated id would never match: the leaderboard would show nobody's name
-- and every pick would settle as a no-show.
--
-- This trigger creates the players row automatically the first time someone
-- signs in, using the same id.
-- ------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into players (id, email, display_name)
  values (
    new.id,
    new.email,
    -- Provisional name from the address; rename it afterwards.
    initcap(replace(split_part(new.email, '@', 1), '.', ' '))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill anyone who already signed in before this ran.
insert into players (id, email, display_name)
select u.id, u.email,
       initcap(replace(split_part(u.email, '@', 1), '.', ' '))
from auth.users u
where not exists (select 1 from players p where p.id = u.id)
on conflict (id) do nothing;
