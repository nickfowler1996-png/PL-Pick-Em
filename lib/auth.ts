import { NextResponse } from "next/server";

/**
 * Cron routes are public URLs, so they carry a shared secret. Timing-safe
 * compare so the secret can't be recovered a byte at a time.
 */
export function requireCron(req: Request): NextResponse | null {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (header.length !== expected.length) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return null;
}
