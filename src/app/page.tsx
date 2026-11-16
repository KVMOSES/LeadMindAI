"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { SessionData } from "@/lib/store";
import { LoginScreen } from "@/components/lm/login-screen";
import { AppShell } from "@/components/lm/app-shell";

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0b0e13] text-zinc-300">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        <p className="text-sm">Starting LeadMind AI…</p>
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

  return <AppShell session={session} />;
}
