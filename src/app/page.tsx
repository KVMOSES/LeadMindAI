"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SessionData } from "@/lib/store";
import { LoginScreen } from "@/components/lm/login-screen";
import { AppShell } from "@/components/lm/app-shell";
import { LogoMark } from "@/components/lm/logo";

export default function Home() {
  const [status, setStatus] = useState<"loading" | "anon" | "authed">("loading");
  const [session, setSession] = useState<SessionData | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const loadSession = async () => {
    try {
      const me = await api<{
        user: SessionData["user"];
        workspace: SessionData["workspace"];
        llmMode: "live" | "demo";
        hasProductionModel: boolean;
      }>("/api/auth/me");
      setSession({
        user: me.user,
        workspace: me.workspace,
        llmMode: me.llmMode,
        hasProductionModel: me.hasProductionModel,
      });
      setStatus("authed");
    } catch {
      setStatus("anon");
    }
  };

  useEffect(() => {
    // Initial session bootstrap: fetch is async, setState happens after await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSession();
  }, []);

  if (status === "loading") {
    return (
      <div className="lm-ambient flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full blur-2xl"
            style={{ background: "radial-gradient(closest-side, var(--lm-brand-soft), transparent)" }}
          />
          <LogoMark size={48} />
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.18em]">Starting LeadMind AI…</p>
        {bootError && <p className="text-xs text-rose-400">{bootError}</p>}
      </div>
    );
  }

  if (status === "anon" || !session) {
    return (
      <LoginScreen
        onAuthenticated={(s) => {
          setSession(s);
          setStatus("authed");
        }}
      />
    );
  }

  return <AppShell session={session} onLogout={() => { setSession(null); setStatus("anon"); }} />;
}
