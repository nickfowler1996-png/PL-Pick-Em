"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function signIn() {
    setState("sending");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  return (
    <main className="wrap" style={{ maxWidth: 380, paddingTop: 64 }}>
      <div className="eyebrow">Premier League Pick &apos;em</div>
      <h1 className="display" style={{ fontSize: 34, marginBottom: 18 }}>Sign in</h1>

      {state === "sent" ? (
        <p className="note">
          Link sent to {email}. Open it on this device — it signs you straight in.
        </p>
      ) : (
        <>
          <input
            className="field"
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email && signIn()}
          />
          <button className="submit" onClick={signIn} disabled={!email || state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a link"}
          </button>
          {state === "error" && (
            <p className="note" style={{ color: "var(--down)" }}>
              That didn&apos;t send. Check the address and try again.
            </p>
          )}
          <p className="note">
            No password. Use the address you were added with — if it isn&apos;t on the
            list, ask whoever runs the pool to add you.
          </p>
        </>
      )}
    </main>
  );
}
