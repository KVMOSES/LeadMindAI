"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { BrainCircuit, Loader2, Lock, Mail, Sparkles, TrendingUp, MessagesSquare, BarChart3, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { SessionData } from "@/lib/store";
import { toast } from "sonner";

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (s: SessionData) => void }) {
  const [email, setEmail] = useState("demo@leadmind.ai");
  const [password, setPassword] = useState("demo1234");
  const [loading, setLoading] = useState<"demo" | "login" | null>(null);

  const enterDemo = async () => {
    setLoading("demo");
    try {
      await api("/api/auth/demo", { method: "POST", body: {} });
      const me = await api<{ user: SessionData["user"]; workspace: SessionData["workspace"]; llmMode: "live" | "demo"; hasProductionModel: boolean }>("/api/auth/me");
      onAuthenticated({
        user: me.user,
        workspace: me.workspace,
        llmMode: me.llmMode,
        hasProductionModel: me.hasProductionModel,
      });
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
      const me = await api<{ user: SessionData["user"]; workspace: SessionData["workspace"]; llmMode: "live" | "demo"; hasProductionModel: boolean }>("/api/auth/me");
      onAuthenticated({
        user: me.user,
        workspace: me.workspace,
        llmMode: me.llmMode,
        hasProductionModel: me.hasProductionModel,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0e13] text-zinc-100">
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Brand panel */}
        <div className="relative flex flex-1 flex-col justify-between overflow-hidden p-8 lg:p-14">
          <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(600px circle at 20% 20%, rgba(16,185,129,0.12), transparent), radial-gradient(500px circle at 80% 70%, rgba(16,185,129,0.08), transparent)" }} />
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <BrainCircuit className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight">LeadMind AI</p>
                <p className="text-xs text-zinc-400">Conversational Sales Intelligence</p>
              </div>
            </div>

            <h1 className="mt-14 max-w-lg text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
              Stop staring at dashboards.
              <span className="text-emerald-400"> Ask your pipeline questions.</span>
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-400">
              LeadMind combines customer-fit scoring, behavioural intent, calibrated conversion predictions and a copilot that investigates your real data on request.
            </p>

            <ul className="mt-10 space-y-4 text-sm">
              {[
                { icon: TrendingUp, text: "Explainable fit, intent and conversion predictions for every lead" },
                { icon: MessagesSquare, text: "Copilot answers from live workspace data — never fabricated" },
                { icon: BarChart3, text: "Model intelligence: training, evaluation, drift monitoring" },
                { icon: ShieldCheck, text: "Workspace isolation, audit logs and confirmation-gated actions" },
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="text-zinc-300">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative mt-12 text-xs text-zinc-500">
            Demo environment ships with a seeded workspace: 26 companies, engagement histories, a trained model and a knowledge base.
          </p>
        </div>

        {/* Auth panel */}
        <div className="flex w-full items-center justify-center border-t border-zinc-800 p-6 lg:w-[440px] lg:border-l lg:border-t-0">
          <Card className="w-full border-zinc-800 bg-[#10141b] text-zinc-100 shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Sign in</CardTitle>
              <CardDescription className="text-zinc-400">Use the demo credentials below, or enter demo mode directly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={enterDemo}
                disabled={loading !== null}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-500 h-11"
              >
                {loading === "demo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {loading === "demo" ? "Preparing demo environment…" : "Enter demo mode"}
              </Button>

              <div className="flex items-center gap-3">
                <Separator className="flex-1 bg-zinc-800" />
                <span className="text-xs text-zinc-500">or sign in</span>
                <Separator className="flex-1 bg-zinc-800" />
              </div>

              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  login();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-zinc-300">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="border-zinc-800 bg-[#0b0e13] pl-9 text-zinc-100 placeholder:text-zinc-600"
                      placeholder="you@company.com"
                      autoComplete="email"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-zinc-300">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border-zinc-800 bg-[#0b0e13] pl-9 text-zinc-100 placeholder:text-zinc-600"
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <Button type="submit" disabled={loading !== null} variant="outline" className="w-full border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800 hover:text-zinc-100 h-11">
                  {loading === "login" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sign in
                </Button>
                <p className="text-center text-xs text-zinc-500">Demo account: demo@leadmind.ai / demo1234</p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
