/**
 * Add players to the pool.
 *
 *   npm run add-players -- "Dev Patel <dev@email.com>" "priya@email.com"
 *   npm run add-players -- --file players.txt
 *
 * One per line in the file, either format. Re-running is safe: existing
 * addresses are reactivated and renamed, not duplicated.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run add-players -- "Name <email>" [more...]');
  console.error("   or: npm run add-players -- --file players.txt");
  process.exit(1);
}

const lines =
  args[0] === "--file"
    ? readFileSync(args[1], "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
    : args;

/** Accepts "Dev Patel <dev@x.com>" or a bare address. */
function parse(line: string): { email: string; name: string } | null {
  const angled = line.match(/^(.*?)\s*<([^>]+)>$/);
  if (angled) return { name: angled[1].trim(), email: angled[2].trim().toLowerCase() };

  const bare = line.trim().toLowerCase();
  if (!bare.includes("@")) return null;
  const local = bare.split("@")[0].replace(/[._-]+/g, " ");
  return { email: bare, name: local.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let added = 0;
for (const line of lines) {
  const parsed = parse(line);
  if (!parsed) { console.warn(`  skipped (no address): ${line}`); continue; }

  // Create the auth user first so the id matches the players row. Magic-link
  // sign-in then lands on an account that already exists.
  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email: parsed.email,
    email_confirm: true,
  });

  let userId = created?.user?.id;

  if (authErr) {
    const { data: list } = await db.auth.admin.listUsers();
    userId = list?.users.find((u) => u.email === parsed.email)?.id;
    if (!userId) { console.error(`  failed: ${parsed.email} — ${authErr.message}`); continue; }
  }

  const { error } = await db.from("players").upsert(
    { id: userId, email: parsed.email, display_name: parsed.name, active: true },
    { onConflict: "email" }
  );

  if (error) console.error(`  failed: ${parsed.email} — ${error.message}`);
  else { console.log(`  ok  ${parsed.name} <${parsed.email}>`); added++; }
}

const { count } = await db.from("players").select("*", { count: "exact", head: true }).eq("active", true);
console.log(`\n${added} processed. ${count} active player${count === 1 ? "" : "s"} in the pool.`);
