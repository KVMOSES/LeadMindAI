"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppStore, type ViewKey, type SessionData } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Users,
  MessagesSquare,
  Zap,
  BrainCircuit,
  Lightbulb,
  MessageSquareHeart,
  Settings,
  LogOut,
  Moon,
  Sun,
  Bot,
  CircleDot,
} from "lucide-react";
import { api } from "@/lib/api";
import { DashboardView } from "@/components/lm/dashboard-view";
import { LeadsView } from "@/components/lm/leads-view";
import { LeadProfileView } from "@/components/lm/lead-profile-view";
import { CopilotView } from "@/components/lm/copilot-view";
import { ActionsView } from "@/components/lm/actions-view";
import { ModelsView } from "@/components/lm/models-view";
import { ExplainabilityView } from "@/components/lm/explainability-view";
import { FeedbackView } from "@/components/lm/feedback-view";
import { SettingsView } from "@/components/lm/settings-view";

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Command Center", icon: LayoutDashboard },
  { key: "leads", label: "Lead Universe", icon: Users },
  { key: "copilot", label: "Copilot", icon: MessagesSquare },
  { key: "actions", label: "Action Center", icon: Zap },
  { key: "models", label: "Model Intelligence", icon: BrainCircuit },
  { key: "explainability", label: "Explainability Studio", icon: Lightbulb },
  { key: "feedback", label: "Feedback & Learning", icon: MessageSquareHeart },
  { key: "settings", label: "Workspace Settings", icon: Settings },
];

export function AppShell({ session }: { session: SessionData }) {
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const syncFromHash = useAppStore((s) => s.syncFromHash);
  const setSession = useAppStore((s) => s.setSession);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    syncFromHash();
    const onPop = () => syncFromHash();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncFromHash]);

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // ignore
    }
    setSession(null);
    toast.success("Signed out");
  };

  const activeLeadId = useAppStore((s) => s.activeLeadId);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside
          className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col justify-between bg-[var(--lm-sidebar)] text-zinc-300 md:flex"
          style={{ background: "var(--lm-sidebar)" }}
        >
          <div>
            <button
              onClick={() => navigate("dashboard")}
              className="flex w-full items-center gap-3 px-5 py-5 text-left"
              aria-label="LeadMind AI home"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <BrainCircuit className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">LeadMind AI</p>
                <p className="text-[10px] text-zinc-500">Sales Intelligence</p>
              </div>
            </button>

            <nav className="mt-2 space-y-0.5 px-3" aria-label="Primary">
              {NAV.map((item) => {
                const active = view === item.key || (item.key === "leads" && view === "lead");
                return (
                  <button
                    key={item.key}
                    onClick={() => navigate(item.key)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-emerald-500/15 text-emerald-300 font-medium" : "text-zinc-400 hover:bg-[var(--lm-sidebar-hover)] hover:text-zinc-200",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="px-3 pb-4">
            <div className="mx-1 rounded-lg bg-[var(--lm-sidebar-hover)] p-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-emerald-400" />
                <p className="text-xs font-medium text-zinc-200">Copilot engine</p>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
                <CircleDot className={cn("h-3 w-3", session.llmMode === "live" ? "text-emerald-400" : "text-amber-400")} />
                {session.llmMode === "live" ? "External LLM connected" : "Local demo assistant"}
              </p>
            </div>
            <div className="mt-2 flex items-center justify-between px-3">
              <span className="text-[11px] text-zinc-500">{session.user.email}</span>
              <button onClick={logout} className="rounded p-1.5 text-zinc-500 hover:bg-[var(--lm-sidebar-hover)] hover:text-zinc-300" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col md:pl-60">
          {/* Topbar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/30 md:hidden">
                <BrainCircuit className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="truncate text-sm font-medium text-muted-foreground">{session.workspace.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {session.llmMode === "demo" && (
                <span className="hidden items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300 sm:inline-flex">
                  Demo assistant (no external LLM)
                </span>
              )}
              <span className="hidden rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
                {session.user.role} · {session.user.name ?? session.user.email}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
                className="h-8 w-8"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </header>

          {/* Mobile nav */}
          <nav className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden" aria-label="Mobile">
            {NAV.map((item) => {
              const active = view === item.key || (item.key === "leads" && view === "lead");
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
                    active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <main className="min-h-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl lm-fade-up" key={view + (activeLeadId ?? "")}>
              {view === "dashboard" && <DashboardView session={session} />}
              {view === "leads" && <LeadsView session={session} />}
              {view === "lead" && <LeadProfileView session={session} />}
              {view === "copilot" && <CopilotView session={session} />}
              {view === "actions" && <ActionsView session={session} />}
              {view === "models" && <ModelsView session={session} />}
              {view === "explainability" && <ExplainabilityView session={session} />}
              {view === "feedback" && <FeedbackView session={session} />}
              {view === "settings" && <SettingsView session={session} />}
            </div>
          </main>

          {/* Sticky footer */}
          <footer className="mt-auto border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between text-xs text-muted-foreground">
              <span>
                LeadMind AI — conversational sales intelligence · {session.workspace.name}
              </span>
              <span className="hidden sm:inline">
                Fit & intent engines · ML predictions · Copilot {session.llmMode === "live" ? "(live LLM)" : "(demo assistant)"}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
