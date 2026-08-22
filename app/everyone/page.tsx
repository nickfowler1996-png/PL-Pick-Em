import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import Nav from "@/app/components/Nav";
import EveryoneGrid from "./EveryoneGrid";

export const dynamic = "force-dynamic";

export default async function Everyone() {
  const db = supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login?next=/everyone");

  return (
    <main className="wrap">
      <header className="mast">
        <div>
          <div className="eyebrow">Premier League</div>
          <h1 className="display">Everyone&apos;s picks</h1>
        </div>
      </header>
      <Nav active="everyone" />
      <EveryoneGrid />
    </main>
  );
}
