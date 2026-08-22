# Premier League Pick 'em

Weekly pick 'em for a private group. Net-profit scoring against live bookmaker
prices, tracked by official Premier League matchweek across four quarters.

## Rules

| Rule | Setting |
|---|---|
| Base stake | $100 per match |
| Correct pick | + profit at the price you took (−110 → +$90.91) |
| Wrong pick | −$100 |
| **No pick submitted** | **−$100 per match, same as picking wrong** |
| Odds | Live at tap time; the price is stamped onto the pick |
| Picks lock | First kickoff of the matchweek, same instant for everyone |
| Doubles | 2 per matchweek — **unused doubles expire, no rollover** |
| Triples | 2 per quarter |
| Quad | 1 per season |
| Multiplier pools | Independent — a triple does not consume a double. A maximum week is 2 doubles + 2 triples + 1 quad = **5 boosted matches** |
| Postponed fixture | Voided: scores nothing, penalises nothing, and refunds any triple or quad staked on it |
| Settlement | After the last match of the matchweek finishes — nothing hits the leaderboard mid-round |
| Quarters | Q1 MW1–9 · Q2 MW10–18 · Q3 MW19–28 · Q4 MW29–38 |
| Payouts | Each quarter winner, plus the season winner |
| Pick visibility | Your own slip any time; everyone else's from first kick-off onward |

Because doubles don't roll over and an unsubmitted slip costs −$100 a match,
skipping a week is expensive: with 10 fixtures that's −$1,000 and two boosts
burned for nothing.

## Layout

    lib/scoring.ts          settlement, no-show penalties, multiplier validation
    lib/matchweek.ts        quarters, send timing, matchday grouping
    lib/settle.ts           readiness check, void grace window, pool settlement
    lib/football-data.ts    fixtures, results, official matchday
    lib/odds-api.ts         odds feed client, team-name reconciliation
    lib/odds-schedule.ts    snapshot cadence and quota guard
    lib/odds-store.ts       reading stored prices back out
    lib/auth.ts             timing-safe cron secret check
    lib/email.ts            Resend templates + per-player magic links
    lib/scoring.test.ts     59 tests
    lib/integration.test.ts 42 tests
    lib/email.test.ts       30 tests
    supabase/schema.sql     tables, lock trigger, standings view, RLS
    lib/pick-grid.ts        the reveal grid
    app/everyone/*          everyone's picks, visible after lock
    app/api/cron/*          the scheduled jobs
    .github/workflows/      cron schedule

## Tests

    ./run-tests.sh

131 tests. Requires Node 22+. The suites never touch the network — the email
templates are pure render functions, tested without an API key.

## Stack

- **Next.js** on Vercel — app and API routes
- **Supabase** — Postgres plus email magic-link auth
- **football-data.org** — fixtures and results; supplies the official
  `matchday` number, which is what drives matchweek grouping
- **The Odds API** — `soccer_epl`, `h2h` market, `uk` region (1 credit per call,
  returns every fixture at once)
- **Resend** — transactional email
- **GitHub Actions** — cron, hitting signed API routes

Roughly $20–30/month all in, nearly all of it the odds feed.

## Environment

    SUPABASE_URL=
    SUPABASE_SERVICE_ROLE_KEY=
    FOOTBALL_DATA_TOKEN=
    ODDS_API_KEY=
    RESEND_API_KEY=
    EMAIL_FROM="Pick 'em <picks@yourdomain.com>"
    APP_URL=https://your-app.vercel.app
    CRON_SECRET=
    SEASON_START_YEAR=2026

## Scheduled jobs

| Job | Cadence | Does |
|---|---|---|
| `sync-fixtures` | daily | Pulls fixtures, regroups by matchday, recomputes send windows |
| `send-invites` | every 6h | Emails any matchweek whose `send_at` has passed |
| `send-reminders` | hourly | Nudges incomplete slips 6h before lock |
| `snapshot-odds` | every 15 min | Stores prices, but only spends a credit when due |
| `settle` | hourly | Closes matchweeks whose last match has finished |

Settlement waits for the whole round. A matchweek closes only when every fixture
in it has finished, so no partial standings leak out mid-weekend. Two escape
hatches stop it hanging:

- A **postponed** fixture is voided immediately and doesn't hold the round up.
- Anything else still unplayed **24 hours after the last scheduled kickoff** is
  voided too, so a rearranged fixture can't freeze the table for weeks.

Send timing is derived, not configured:

    send_at = first_kickoff − 72h
    if send_at < previous matchweek's last kickoff:
        send_at = first_kickoff − 24h

Midweek rounds fall into the compressed window automatically.

## Capacity

Sized for 10-15 players. Every service stays inside its free tier at that
headcount except the odds feed:

| Service | Free ceiling | Expected at 15 players |
|---|---|---|
| Supabase | 50k monthly active users, 500MB | ~15 users, a few MB a season |
| Resend | 3,000 emails/month, 100/day | ~180/month (3 sends x 15 x 4 weeks) |
| football-data.org | 10 requests/minute | 1 sync a day |
| The Odds API | 500 credits/month | ~190/month average, ~250 worst case |

Prices are captured on a schedule rather than fetched when someone opens the
page, so spend doesn't depend on how much anyone browses. See below.

## Odds budget

The snapshot cron runs every 15 minutes but only calls the feed when the
cadence says it's due, tightening as the deadline nears:

| Time to lock | Refresh | Calls |
|---|---|---|
| 72h - 24h | every 2 hours | 24 |
| 24h - 2h | every hour | 22 |
| final 2 hours | every 15 min | 8 |
| | | **54 per round** |

A compressed midweek round costs about 30. A full 38-week season is roughly
1,900 calls — about 190 a month, against a free ceiling of 500. Even a
congested six-round December lands near 250.

The pick page reads stored snapshots, so refreshing it is free no matter how
many people do it. `QUOTA_FLOOR` in `lib/odds-schedule.ts` stops the job
spending the last 25 credits, so a bug can't drain the month.

## Notes on the feeds

The two providers disagree on club names — football-data returns "Nott'm
Forest" where the odds feed returns "Nottingham Forest". `teamKey()` in
`lib/odds-api.ts` normalises both sides so fixtures can be joined. Add a rule
there if a new promoted club doesn't line up.

Prices are the **best available across UK books** for each outcome, which is
what OddsChecker shows and stops one book's outlier setting the line. If the
odds feed errors, the client serves the last cached response rather than
breaking the pick page.

## Email

Three sends, all carrying a per-player Supabase magic link so nobody needs a
password:

| Send | When | Says |
|---|---|---|
| Invite | `send_at` passes | Board is open; flags a short week explicitly |
| Reminder | 24h before lock | How many blanks you have and what they'll cost |
| Recap | Matchweek settles | Winner, your line, and the quarter/season table |

If `generateLink` fails the email still goes out with a plain URL — a login
prompt beats a broken link.

Sends are logged per player in `email_sends`, not per matchweek, so someone who
joins midway through a week still gets the invite on the next pass rather than
missing the round. Reminders go only to players with an incomplete slip.

The 24-hour reminder lead suits a pool spread across time zones — a 6-hour
warning on a 15:00 UK kick-off arrives at 4am in the eastern US. On a
compressed midweek round the whole window is 24 hours, so the reminder moves to
the midpoint instead.

## Still to build

- Pick page and leaderboard wired to real data (prototype exists separately)
- Supabase magic-link sign-in page
