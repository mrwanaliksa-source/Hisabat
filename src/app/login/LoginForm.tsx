"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loginEmail } from "@/lib/username";

type Labels = { email: string; password: string; btn: string; busy: string; error: string };

export function LoginForm({ labels }: { labels: Labels }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: loginEmail(email), password });
    if (error) {
      setError(labels.error);
      setBusy(false);
      return;
    }
    // direct company link: /login?c=trio → that company (if this user may enter it)
    const c = new URLSearchParams(window.location.search).get("c");
    window.location.href = c ? `/choose-company?c=${encodeURIComponent(c)}` : "/choose-company";
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <label className="field">
        <span>{labels.email}</span>
        <input type="text" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>{labels.password}</span>
        <input type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="alert error">{error}</p>}
      <button className="btn primary block" disabled={busy}>{busy ? labels.busy : labels.btn}</button>
    </form>
  );
}
