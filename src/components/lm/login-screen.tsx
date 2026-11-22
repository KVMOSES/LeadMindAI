"use client";

import { SmokeLogin } from "@/components/ui/smoke-login";
import { api } from "@/lib/api";
import type { SessionData } from "@/lib/store";
import { toast } from "sonner";

/**
 * LoginScreen — authentication entry point.
 *
 * Presentation is delegated to the SmokeLogin component; every behaviour here
 * is the real, existing authentication flow:
 *  - POST /api/auth/login  → credential verification + httpOnly session cookie
 *  - POST /api/auth/demo   → seeded demo workspace session
 *  - GET  /api/auth/me     → session bootstrap after either path
 *
 * Errors are rethrown so SmokeLogin can render them inline (no fake success,
 * no client-side credential storage).
 */
export function LoginScreen({ onAuthenticated }: { onAuthenticated: (s: SessionData) => void }) {
  const bootstrapSession = async () => {
    const me = await api<{
      user: SessionData["user"];
      workspace: SessionData["workspace"];
      llmMode: "live" | "demo";
      hasProductionModel: boolean;
    }>("/api/auth/me");
    onAuthenticated({
      user: me.user,
      workspace: me.workspace,
      llmMode: me.llmMode,
      hasProductionModel: me.hasProductionModel,
    });
  };

  const login = async (email: string, password: string) => {
    await api("/api/auth/login", { method: "POST", body: { email, password } });
    await bootstrapSession();
  };

  const enterDemo = async () => {
    await api("/api/auth/demo", { method: "POST", body: {} });
    await bootstrapSession();
    toast.success("Welcome to LeadMind AI — demo environment ready");
  };

  return (
    <SmokeLogin
      onSubmit={login}
      onDemo={enterDemo}
      demoEmail="demo@leadmind.ai"
      demoPassword="demo1234"
    />
  );
}
