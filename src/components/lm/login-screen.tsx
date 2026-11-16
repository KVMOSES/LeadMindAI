"use client";

import { useState } from "react";
import { BrainCircuit, Loader2, Lock, Mail, MessagesSquare, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LiquidGlassButton } from "@/components/ui/liquid-glass-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { api } from "@/lib/api";
import type { SessionData } from "@/lib/store";
import { toast } from "sonner";

const FEATURES = [
  { icon: TrendingUp, text: "Explainable fit, intent and conversion predictions for every lead" },
  { icon: MessagesSquare, text: "Copilot answers from live workspace data — never fabricated" },
  { icon: Sparkles, text: "Next-best actions with evidence, priorities and outcome learning" },
  { icon: ShieldCheck, text: "Workspace isolation, RBAC, audit logs and confirmation-gated actions" },
] as const;

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (s: SessionData) => void }) {
  const [email, setEmail] = useState("demo@leadmind.ai");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState<"demo" | "login" | null>(null);

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

  const enterDemo = async () => {
    setLoading("demo");
    try {
      await api("/api/auth/demo", { method: "POST", body: {} });
      await bootstrapSession();
      toast.success("Welcome to LeadMind AI — demo environment ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to enter demo mode");
    } finally {
      setLoading(null);
    }
  };

  const login = async () => {
    setLoading("login");
    try {
      await api("/api/auth/login", { method: "POST", body: { email, password } });
      await bootstrapSession();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="lm-ambient flex min-h-screen flex-col bg-[var(--lm-sidebar)] text-foreground">
      {/* Top brand strip */}
      <header className="flex items-center gap-3 px-6 py-5 lg:px-10">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/30">
          <BrainCircuit className="h-4.5 w-4.5 text-[var(--lm-brand)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">LeadMind AI</p>
          <p className="text-[11px] text-muted-foreground">Conversational Sales Intelligence</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Brand panel */}
        <div className="relative flex flex-1 flex-col justify-center px-6 py-10 lg:px-14">
          <h1 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight lg:text-[2.6rem] lg:leading-[1.15]">
            Stop staring at dashboards.
            <span className="lm-brand-text block">Ask your pipeline questions.</span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
            LeadMind combines customer-fit scoring, behavioural intent, calibrated conversion predictions and a copilot
            that investigates your real data on request — every answer traceable to the tools that produced it.
          </p>

          <ul className="mt-10 grid max-w-xl gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lm-brand)]" aria-hidden="true" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>

          <p className="mt-10 text-xs text-muted-foreground">
            The demo environment ships with a seeded workspace — companies, engagement histories, a trained model and a knowledge base.
          </p>
        </div>

        {/* Auth panel */}
        <div className="flex w-full items-center justify-center border-t p-6 lg:w-[460px] lg:border-l lg:border-t-0">
          <SpotlightCard className="w-full max-w-sm p-6" spotlightColor="var(--lm-brand-soft)">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription className="mt-1 text-sm text-muted-foreground">
              Use the demo credentials below, or enter demo mode directly.
            </CardDescription>

            <CardContent className="mt-5 space-y-4 p-0">
              <LiquidGlassButton
                variant="brand"
                size="lg"
                className="w-full"
                onClick={enterDemo}
                loading={loading === "demo"}
                disabled={loading !== null}
              >
                {loading !== "demo" && <Sparkles className="size-4" aria-hidden="true" />}
                {loading === "demo" ? "Preparing demo environment…" : "Enter demo mode"}
              </LiquidGlassButton>

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or sign in</span>
                <Separator className="flex-1" />
              </div>

              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  login();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      placeholder="you@company.com"
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={loading !== null}
                  className="h-11 w-full"
                >
                  {loading === "login" && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                  Sign in
                </Button>
                <p className="text-center text-xs text-muted-foreground">Demo account: demo@leadmind.ai / demo1234</p>
              </form>
            </CardContent>
          </SpotlightCard>
        </div>
      </div>
    </div>
  );
}
