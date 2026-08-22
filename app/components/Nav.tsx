import Link from "next/link";

/** Shared tab bar. `active` marks the current page. */
export default function Nav({ active }: { active: "slip" | "everyone" | "standings" }) {
  return (
    <nav className="tabs">
      <Link className="tab" data-on={active === "slip"} href="/">Your slip</Link>
      <Link className="tab" data-on={active === "everyone"} href="/everyone">Everyone</Link>
      <Link className="tab" data-on={active === "standings"} href="/standings">Standings</Link>
    </nav>
  );
}
