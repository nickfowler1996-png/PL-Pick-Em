# Setup

About 45 minutes end to end. Do the steps in order — later ones need keys from
earlier ones.

---

## What each service does

Six accounts in total. It looks like a lot; four of them you touch once and
never again.

| Service | Its job | How often you touch it |
|---|---|---|
| **GitHub** | Stores the code, and runs the weekly schedule | Once at setup |
| **Vercel** | Runs the actual website your friends visit | Once at setup |
| **Supabase** | The database, and the sign-in system | Once, plus adding players |
| **football-data.org** | Supplies the fixture list and results | Never after setup |
| **The Odds API** | Supplies the betting prices | Never after setup |
| **Resend** | Sends the emails | Never after setup |

GitHub and Vercel are free and both let you sign up with a Google account.

---

## 1. Accounts and keys

Sign up for four things. Keep a scratch file open and paste each key in as you go.

| Service | Where | What you need | Cost |
|---|---|---|---|
| Supabase | supabase.com — new project | Project URL, anon key, service_role key | Free |
| football-data.org | football-data.org/client/register | API token (arrives by email) | Free |
| The Odds API | the-odds-api.com | API key — the **free** tier is enough | Free |
| Resend | resend.com | API key, plus a verified sending domain | Free |

On Supabase the two keys live under **Project Settings → API**. The
`service_role` key bypasses all security rules — it goes in server environment
variables only, never in the browser, never in git.

On Resend you need to verify a domain you own before it will send to your
friends. If you don't have one, Resend's onboarding walks through the DNS
records. The free tier covers 3,000 emails a month; you'll use around 180.

---

## 2. Project creation settings

Supabase asks about these while the project is being created, and the Advanced
ones **can't be changed afterwards**.

| Setting | Choose | Why |
|---|---|---|
| Enable Data API | **On** | The app talks to Postgres through it. Nothing works without it. |
| Automatically expose new tables | **On** | Fine here — `schema.sql` locks every table with Row Level Security, so exposure alone grants nobody anything. |
| Enable automatic RLS | **On** | A safety net. If you ever add a table and forget to secure it, this catches you. |
| Postgres Type | **Postgres (default)** | OrioleDB is alpha. Not for something you want running untouched for nine months. |

The second one is worth a word, since Supabase's own hint suggests turning it
off. Their caution is aimed at people who expose tables and then rely on
obscurity. `schema.sql` enables RLS on all six tables with explicit read
policies and no write policies, so the anon key can read the fixture list and
the leaderboard and nothing else. Auto-expose is safe against that.

---

## 3. Create the database

In Supabase, open **SQL Editor → New query**. Paste the entire contents of
`supabase/schema.sql` and run it, then do the same with
`supabase/02-auth-link.sql`. That builds every table, the lock trigger, the
standings view, the security policies, and live updates.

Confirm the lockdown worked — this should return six rows, all `t`:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Then go to **Authentication → Providers** and confirm **Email** is enabled with
**Confirm email** turned off. Sign-in is magic-link only — there are no
passwords in this app.

---

## 4. Get the code onto GitHub

Download `pickem.zip` and unzip it. You'll get a folder called `pickem`
containing folders named `app`, `lib`, `supabase`, `scripts` and some loose
files. Don't rearrange any of it.

### The easy way — GitHub Desktop

Recommended unless you already use git from a terminal.

1. Make a free account at **github.com**.
2. Download **GitHub Desktop** from desktop.github.com and sign in.
3. In GitHub Desktop: **File → New Repository**. Name it `pickem`. Pick any
   local folder for it. Click **Create Repository**.
4. Click **Show in Finder** (or Explorer). A folder called `pickem` opens.
5. Copy everything from *inside* your unzipped `pickem` folder into this new
   one. You want `app`, `lib`, `package.json` and so on sitting at the top
   level — not a `pickem` folder inside a `pickem` folder.
6. Back in GitHub Desktop you'll now see a long list of changed files. Type
   "first commit" in the Summary box, bottom left, and click **Commit to main**.
7. Click **Publish repository** at the top. Untick **Keep this code private**
   only if you want it public — private is fine and works the same.

### If you prefer the browser

Works, but with one trap. At github.com click **New repository**, name it
`pickem`, create it, then **uploading an existing file** and drag your files in.

The trap: browsers hide folders whose name starts with a dot, so the
`.github` folder — the one holding your weekly schedule — usually won't upload.
Check afterwards whether you can see `.github` in the file list. If you can't,
click **Add file → Create new file**, and type this as the filename:

    .github/workflows/cron.yml

GitHub turns the slashes into folders automatically. Then paste in the contents
of that file from your unzipped copy and commit.

---

## 5. Deploy to Vercel

1. Go to **vercel.com** and sign in **with your GitHub account** — this matters,
   it's how Vercel sees your code.
2. Click **Add New → Project**. Your `pickem` repository appears in the list.
   Click **Import**.
3. Don't change the build settings. Vercel recognises Next.js on its own.
4. Expand **Environment Variables** and add every line from `.env.example`,
   one at a time — name on the left, value on the right. Leave `APP_URL` out
   for now.
5. For `CRON_SECRET` you need a long random string. Any password generator
   works, or on a Mac terminal: `openssl rand -hex 32`. Save a copy — GitHub
   needs the identical value later.
6. Click **Deploy** and wait a couple of minutes.
7. You now have a URL like `pickem-abc123.vercel.app`. Go to **Settings →
   Environment Variables**, add `APP_URL` with that URL — no trailing slash —
   then **Deployments → ⋯ → Redeploy**.

The first deploy failing is normal if a variable is missing. The log names
which one.

Back in Supabase, go to **Authentication → URL Configuration** and set the Site
URL to your Vercel URL, then add `https://your-app.vercel.app/auth/callback` as
a redirect URL. Magic links won't work until you do.

---

## 6. Add your friends

Two ways. Pick whichever you prefer.

**Just send them the link.** Run `supabase/02-auth-link.sql` once in the SQL
Editor, and from then on anyone who signs in gets a player row created
automatically, sharing the id of their sign-in account. That id match is
essential — picks are stored against the sign-in account, so a mismatched
players row would make every pick settle as a no-show.

Send your friends `https://your-app.vercel.app`, they enter their email, and
they're in.

Their display name is guessed from the address (`dev.patel@email.com` becomes
"Dev Patel"). To tidy names up:

```sql
update players set display_name = 'Dev' where email = 'dev@email.com';
```

Anyone with the link can sign themselves in, so don't post it publicly. To
remove someone, set `active = false` — their history stays on the board.

**Pre-creating accounts** — if you'd rather add people before they sign in,
copy `players.example.txt`, put one person per line, then:

    npm install
    npm run add-players -- --file players.txt

The script also creates the matching auth accounts, so their first magic link
lands on an account that already exists. Running it again is safe: it updates
names and reactivates people rather than duplicating them.

To add someone mid-season, just run it again with the new address. To remove
someone without deleting their history:

```sql
update players set active = false where email = 'someone@email.com';
```

Inactive players stop receiving emails and stop being settled, but their past
results stay on the board.

---

## 7. Load the fixtures

Your weekly schedule lives on GitHub, so it needs two of the same values.

On github.com open your `pickem` repository, then **Settings → Secrets and
variables → Actions → New repository secret**. Add these two:

- `CRON_SECRET` — the exact same random string you gave Vercel
- `APP_URL` — your Vercel URL, no trailing slash

These must match Vercel exactly or the scheduled jobs get rejected as
unauthorised.

Then run the fixture sync once by hand: **Actions → Pick 'em jobs → Run
workflow → sync-fixtures**. It pulls all 380 fixtures, groups them into the 38
official matchweeks, and works out when each email should go out.

Check it worked in Supabase:

```sql
select mw_number, send_mode, first_kickoff, send_at
from matchweeks order by mw_number limit 12;
```

You should see 38 rows. Any round marked `compressed` is a midweek one that
gets the 24-hour email instead of the 72-hour one.

After that, the four scheduled jobs run on their own — fixtures sync daily,
invites go out every six hours, reminders hourly, settlement hourly.

---

## 8. Check it end to end

1. Visit your Vercel URL. You should be sent to the sign-in page.
2. Enter your own address, open the emailed link.
3. You land on the current matchweek with live prices on every match.
4. Tap a pick — it saves instantly, no submit button.
5. Tap **Add multiplier** and confirm the counters at the top go down.
6. Visit `/standings` — empty until the first round settles.

If prices show as `—`, run the `snapshot-odds` job manually from the Actions
tab — its response tells you whether it fetched, skipped, or couldn't match a
club name. If the page is blank, check the Vercel deployment logs.

---

## Where people go, day to day

| Page | What it's for |
|---|---|
| `/` | Jumps to whichever matchweek is currently open |
| `/matchweek/12` | That round's picks |
| `/everyone` | What everyone picked — unlocks at first kick-off |
| `/standings` | The live leaderboard |

Nobody has to remember these. Every email contains a one-tap link that signs
them in and drops them on the right page.

---

## The leaderboard, and what "live" means

`/standings` holds an open connection to the database and redraws the instant
anything changes — no refresh, no polling. If the connection drops (some office
wifi blocks websockets) it quietly falls back to checking every 60 seconds.

Worth setting expectations with your friends, though: **totals only move once a
matchweek**, when the last match of the round finishes and settlement runs. That
was a deliberate call — settling match by match would let whoever picks last see
how far behind they are.

What *does* update through the weekend is the progress line at the top:
"Matchweek 12 in progress · 7 of 10 played". So the page is worth watching on a
Sunday, it just won't reshuffle until the round is done.

---

## Running costs

**Nothing.** Every service stays inside its free tier at 10–15 players.

The one that needed care was The Odds API, capped at 500 calls a month. Rather
than pricing a match whenever someone opens the page — which would depend on
how much your friends browse — prices are captured on a fixed schedule that
tightens as the deadline nears:

| Time to lock | Refresh |
|---|---|
| 3 days to 1 day out | every 2 hours |
| final day | every hour |
| final 2 hours | every 15 minutes |

That's 54 calls for a normal round, 30 for a midweek one — roughly 190 a month,
or about 250 in a congested December. The pick page reads stored prices, so
refreshing it costs nothing however many people are looking.

There's a floor built in too: the job refuses to spend the last 25 credits, so
a bug can't burn through the month. If you ever want faster prices, the $20
tier gives 20,000 calls and you'd change the tiers in
`lib/odds-schedule.ts`.

---

## When something breaks

**GitHub Actions says "unauthorized".** `CRON_SECRET` doesn't match between
GitHub and Vercel. Re-paste it in both places — a trailing space is the usual
culprit.

**Vercel build failed.** Open the deployment and read the log; it names the
missing environment variable. Add it under Settings, then redeploy.

**Emails aren't arriving.** Check Resend's dashboard for bounces. Domain not
verified is the usual cause. Confirm `send_at` has actually passed:
`select mw_number, send_at, invite_sent_at from matchweeks where invite_sent_at is null;`

**The leaderboard is stuck.** A matchweek only settles once every fixture in it
has finished. Postponed matches are voided automatically, and anything still
unplayed 24 hours after the last scheduled kickoff gets voided too, so it should
never hang for long. To see what it's waiting on, run the settle job manually
from the Actions tab — the response lists it.

**Prices show as `—` on a brand-new setup.** The snapshot job only runs once
the invite window opens, so a matchweek more than 3 days out won't be priced
yet. To force one, run **Actions → Pick 'em jobs → Run workflow →
snapshot-odds**; the response says whether it fetched or why it skipped.

**A club's odds show as `—`.** The two data feeds disagree on that club's name.
Add a rule to `teamKey()` in `lib/odds-api.ts` — the existing entries show the
pattern. Most likely to bite in August after promotion.

**The leaderboard is empty but rounds have settled.** Row Level Security is
probably blocking the read. Re-run the policy block at the bottom of
`schema.sql` — the `roster readable` policy in particular, since without it
player names can't be joined.

**Someone says their picks vanished.** Check they signed in with the address
they were added under. A second address means a second account.
