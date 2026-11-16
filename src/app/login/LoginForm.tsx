"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

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
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(labels.error);
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <form onSubmit={onSubmit} className="stack">
      <label className="field">
        <span>{labels.email}</span>
        <input type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
