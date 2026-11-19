"use client";

// Sign in, when OPENCREWBOT_PASSWORD is set (on a deployment). The proxy sends every other page here
// until the session cookie is set.
import { useState, type FormEvent } from "react";
import { Button, Mascot, inputClass } from "@/components/ui";

/** Only paths inside the app, so a crafted link can't send you to another site after signing in. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        window.location.assign(nextPath());
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Couldn't sign in.");
    } catch {
      setError("Couldn't reach the app.");
    }
    setBusy(false);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-raised p-7 ring-1 ring-line">
        <div className="flex flex-col items-center gap-3">
          <Mascot color="#f4f4f4" size={56} />
          <h1 className="text-[18px] font-semibold">OpenCrewBot</h1>
          <p className="text-center text-[13px] text-mute">This workspace is private. Enter its password.</p>
        </div>
        <input
          className={`${inputClass} mt-5`}
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        <Button variant="primary" className="mt-4 w-full justify-center" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
