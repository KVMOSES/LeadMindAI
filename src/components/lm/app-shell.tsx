"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useAppStore, type ViewKey, type SessionData } from "@/lib/store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Activity,
  Bell,
  BookUser,
  BrainCircuit,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Command as CommandIcon,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  MessagesSquare,
  Menu,
  MessageSquareHeart,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  Sun,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DashboardView } from "@/components/lm/dashboard-view";
import { LeadsView } from "@/components/lm/leads-view";
import { LeadProfileView } from "@/components/lm/lead-profile-view";
import { ProfilesView } from "@/components/lm/profiles-view";
import { QualificationView } from "@/components/lm/qualification-view";
import { CopilotView } from "@/components/lm/copilot-view";
import { ActionsView } from "@/components/lm/actions-view";
import { ModelsView } from "@/components/lm/models-view";
import { ExplainabilityView } from "@/components/lm/explainability-view";
import { FeedbackView } from "@/components/lm/feedback-view";
import { MonitoringView } from "@/components/lm/monitoring-view";
import { SettingsView } from "@/components/lm/settings-view";

// ── Navigation model ─────────────────────────────────────────────────────────

interface NavItem {
  key: ViewKey;
  label: string;
  icon: typeof LayoutDashboard;
  matchViews?: ViewKey[];
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Pipeline",
    items: [
      { key: "dashboard", label: "Command Center", icon: LayoutDashboard },
      { key: "leads", label: "Lead Universe", icon: Users, matchViews: ["lead"] },
      { key: "profiles", label: "Intelligence Profiles", icon: BookUser },
      { key: "qualification", label: "Qualification", icon: ClipboardCheck },
    ],
  },
  {
    label: "Assist",
    items: [
      { key: "actions", label: "Next Best Action", icon: Zap },
      { key: "copilot", label: "AI Copilot", icon: MessagesSquare },
    ],
  },
  {
    label: "Model Ops",
    items: [
      { key: "models", label: "Model Intelligence", icon: BrainCircuit },
      { key: "explainability", label: "Explainability Studio", icon: Lightbulb },
      { key: "feedback", label: "Feedback & Learning", icon: MessageSquareHeart },
      { key: "monitoring", label: "Monitoring", icon: Activity },
    ],
  },
  {
    label: "Workspace",
    items: [{ key: "settings", label: "Settings", icon: Settings2 }],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function navLabelFor(view: ViewKey): string {
  if (view === "lead") return "Lead Universe";
  return ALL_NAV_ITEMS.find((item) => item.key === view)?.label ?? "Command Center";
}

// ── Brand mark ───────────────────────────────────────────────────────────────

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", compact && "justify-center")}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/30">
        <BrainCircuit className="h-4.5 w-4.5 text-[var(--lm-brand)]" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-zinc-100">LeadMind AI</p>
          <p className="truncate text-[10px] text-zinc-500">Sales Intelligence OS</p>
        </div>
      )}
    </div>
  );
}

// ── Main shell ───────────────────────────────────────────────────────────────

export function AppShell({ session, onLogout }: { session: SessionData; onLogout?: () => void }) {
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);
  const syncFromHash = useAppStore((s) => s.syncFromHash);
  const setSession = useAppStore((s) => s.setSession);
  const activeLeadId = useAppStore((s) => s.activeLeadId);
  const { theme, setTheme } = useTheme();

  const [collapsed, setCollapsed] = useState(() => {
    // The shell only mounts client-side after auth, so localStorage is safe here.
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("lm.sidebar.collapsed") === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("lm.sidebar.collapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  // Hash routing sync
  useEffect(() => {
    syncFromHash();
    const onPop = () => syncFromHash();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncFromHash]);

  // Global command palette shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // ignore network failures on logout
    }
    setSession(null);
    // Notify the host (page.tsx owns the session state) so the login screen renders.
    onLogout?.();
    toast.success("Signed out");
  };

  const isActive = (item: NavItem) => item.matchViews?.includes(view) || view === item.key;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1">
        {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 hidden flex-col border-r bg-[var(--lm-sidebar)] transition-[width] duration-200 md:flex",
            collapsed ? "w-[64px]" : "w-60",
          )}
          style={{ background: "var(--lm-sidebar)" }}
          aria-label="Primary navigation"
        >
          <div className={cn("flex h-14 items-center border-b px-3", collapsed ? "justify-center" : "justify-between")}>
            <button onClick={() => navigate("dashboard")} aria-label="LeadMind AI home" className="min-w-0">
              <BrandMark compact={collapsed} />
            </button>
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-zinc-400 hover:text-zinc-200"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="size-4" />
              </Button>
            )}
          </div>
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              className="mx-auto mt-2 flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-[var(--lm-sidebar-hover)] hover:text-zinc-200"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}

          <nav className={cn("lm-scroll mt-3 flex-1 space-y-4 overflow-y-auto px-3 pb-4", collapsed && "px-2")} aria-label="Primary">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                {!collapsed && (
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    {group.label}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item);
                    return (
                      <li key={item.key}>
                        <button
                          onClick={() => navigate(item.key)}
                          aria-current={active ? "page" : undefined}
                          title={collapsed ? item.label : undefined}
                          className={cn(
                            "group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                            collapsed && "justify-center px-0",
                            active
                              ? "bg-[var(--lm-brand-soft)] font-medium text-[var(--lm-brand)]"
                              : "text-zinc-400 hover:bg-[var(--lm-sidebar-hover)] hover:text-zinc-100",
                          )}
                        >
                          {active && (
                            <span
                              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[var(--lm-brand)]"
                              aria-hidden="true"
                            />
                          )}
                          <item.icon className="size-4 shrink-0" aria-hidden="true" />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className={cn("border-t p-3", collapsed && "px-2")}>
            {!collapsed ? (
              <div className="rounded-lg bg-[var(--lm-sidebar-hover)] p-3 text-zinc-200">
                <div className="flex items-center gap-2">
                  <CircleDot
                    className={cn("size-3.5", session.llmMode === "live" ? "text-emerald-400" : "text-amber-400")}
                    aria-hidden="true"
                  />
                  <p className="text-xs font-medium">{session.llmMode === "live" ? "External LLM connected" : "Local demo assistant"}</p>
                </div>
                <p className="mt-1 truncate text-[11px] text-zinc-400" title={session.user.email}>
                  {session.user.email}
                </p>
                <Button variant="ghost" size="sm" className="mt-2 h-7 w-full justify-start text-xs text-zinc-400 hover:text-zinc-200" onClick={logout}>
                  <LogOut className="size-3.5" aria-hidden="true" />
                  Sign out
                </Button>
              </div>
            ) : (
              <button
                onClick={logout}
                className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-[var(--lm-sidebar-hover)] hover:text-zinc-200"
                aria-label="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </aside>

        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className={cn("flex min-w-0 flex-1 flex-col transition-[padding] duration-200", collapsed ? "md:pl-[64px]" : "md:pl-60")}>
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </Button>

              {/* Breadcrumbs */}
              <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm sm:flex">
                <span className="truncate text-muted-foreground">{session.workspace.name}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className="truncate font-medium" aria-current="page">
                  {navLabelFor(view)}
                </span>
              </nav>
              <span className="truncate text-sm font-medium sm:hidden">{navLabelFor(view)}</span>

              <div className="ml-auto flex items-center gap-1.5">
                {/* Global search */}
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="hidden h-8 items-center gap-2 rounded-md border bg-muted/50 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex"
                  aria-label="Open global search"
                >
                  <Search className="size-3.5" aria-hidden="true" />
                  <span className="pr-4">Search leads…</span>
                  <kbd className="pointer-events-none inline-flex items-center gap-0.5 rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
                    <CommandIcon className="size-2.5" aria-hidden="true" />K
                  </kbd>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 sm:hidden"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Open global search"
                >
                  <Search className="size-4" />
                </Button>

                {/* Notifications (live operational signals) */}
                <NotificationsPopover
                  open={notifOpen}
                  onOpenChange={setNotifOpen}
                  llmMode={session.llmMode}
                  hasProductionModel={session.hasProductionModel}
                />

                {/* Theme */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                >
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>

                {/* User */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex h-8 items-center gap-2 rounded-full border bg-muted/50 pl-1 pr-2.5 transition-colors hover:bg-muted"
                      aria-label="Open user menu"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--lm-brand-soft)] text-[11px] font-semibold text-[var(--lm-brand)]">
                        {(session.user.name ?? session.user.email).charAt(0).toUpperCase()}
                      </span>
                      <span className="hidden max-w-28 truncate text-xs font-medium sm:inline">
                        {session.user.name ?? session.user.email}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="space-y-0.5">
                      <p className="truncate text-sm font-medium">{session.user.name ?? session.user.email}</p>
                      <p className="truncate text-xs font-normal text-muted-foreground">{session.user.email}</p>
                      <p className="pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {session.user.role} · {session.workspace.name}
                      </p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                      {theme === "dark" ? "Light theme" : "Dark theme"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600 dark:text-rose-400">
                      <LogOut className="size-4" aria-hidden="true" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="min-h-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="lm-fade-up mx-auto w-full max-w-[1400px]" key={view + (activeLeadId ?? "")}>
              {view === "dashboard" && <DashboardView session={session} />}
              {view === "leads" && <LeadsView session={session} />}
              {view === "lead" && <LeadProfileView session={session} />}
              {view === "profiles" && <ProfilesView session={session} />}
              {view === "qualification" && <QualificationView session={session} />}
              {view === "copilot" && <CopilotView session={session} />}
              {view === "actions" && <ActionsView session={session} />}
              {view === "models" && <ModelsView session={session} />}
              {view === "explainability" && <ExplainabilityView session={session} />}
              {view === "feedback" && <FeedbackView session={session} />}
              {view === "monitoring" && <MonitoringView session={session} />}
              {view === "settings" && <SettingsView session={session} />}
            </div>
          </main>

          {/* Sticky footer */}
          <footer className="mt-auto border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <BrainCircuit className="size-3.5 text-[var(--lm-brand)]" aria-hidden="true" />
                LeadMind AI — conversational sales intelligence · {session.workspace.name}
              </span>
              <span className="hidden sm:inline">
                Fit &amp; intent engines · ML predictions · Copilot {session.llmMode === "live" ? "(live LLM)" : "(demo assistant)"}
              </span>
            </div>
          </footer>
        </div>
      </div>

      {/* ── Mobile navigation sheet ────────────────────────────────────────── */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-r bg-[var(--lm-sidebar)] p-0">
          <SheetHeader className="border-b px-4 py-3.5">
            <SheetTitle asChild>
              <div>
                <BrandMark />
              </div>
            </SheetTitle>
          </SheetHeader>
          <nav className="lm-scroll space-y-4 overflow-y-auto px-3 py-4" aria-label="Mobile">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item);
                    return (
                      <li key={item.key}>
                        <button
                          onClick={() => {
                            navigate(item.key);
                            setMobileOpen(false);
                          }}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
                            active
                              ? "bg-[var(--lm-brand-soft)] font-medium text-[var(--lm-brand)]"
                              : "text-muted-foreground hover:bg-[var(--lm-sidebar-hover)] hover:text-foreground",
                          )}
                        >
                          <item.icon className="size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="border-t px-3 py-3">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleDot className={cn("size-3", session.llmMode === "live" ? "text-emerald-400" : "text-amber-400")} aria-hidden="true" />
              {session.llmMode === "live" ? "External LLM connected" : "Local demo assistant"}
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Global command palette ─────────────────────────────────────────── */}
      <GlobalPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={() => setPaletteOpen(false)} />
    </div>
  );
}

// ── Notifications popover (real signals only) ────────────────────────────────

interface NotifItem {
  id: string;
  title: string;
  detail: string;
  severity: "ok" | "info" | "warning" | "critical";
}

function NotificationsPopover({
  open,
  onOpenChange,
  llmMode,
  hasProductionModel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  llmMode: "live" | "demo";
  hasProductionModel: boolean;
}) {
  const [items, setItems] = useState<NotifItem[] | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (!open || loadingRef.current) return;
    loadingRef.current = true;
    Promise.all([
      api<{ report: { status: string; overallPsi: number } | null }>("/api/monitoring/drift").catch(() => ({ report: null })),
      api<{ report: { issues: string[] } | null }>("/api/monitoring/quality").catch(() => ({ report: null })),
    ]).then(([drift, quality]) => {
      const list: NotifItem[] = [];
      list.push({
        id: "llm",
        title: llmMode === "live" ? "Copilot: external LLM connected" : "Copilot: local demo assistant",
        detail: llmMode === "live" ? "Live model answering with tools." : "Deterministic assistant using live workspace data.",
        severity: llmMode === "live" ? "ok" : "warning",
      });
      list.push({
        id: "model",
        title: hasProductionModel ? "Production model active" : "No production model",
        detail: hasProductionModel ? "Conversion predictions are enabled." : "Train a model to enable predictions.",
        severity: hasProductionModel ? "ok" : "warning",
      });
      if (drift.report) {
        list.push({
          id: "drift",
          title: `Feature drift: ${drift.report.status}`,
          detail: `Overall PSI ${drift.report.overallPsi.toFixed(3)}.`,
          severity: drift.report.status === "STABLE" ? "ok" : drift.report.status === "WARNING" ? "warning" : "critical",
        });
      }
      if (quality.report) {
        const n = quality.report.issues.length;
        list.push({
          id: "quality",
          title: n === 0 ? "Data quality: no issues" : `Data quality: ${n} issue${n === 1 ? "" : "s"}`,
          detail: n === 0 ? "All scanned fields look healthy." : quality.report.issues[0],
          severity: n === 0 ? "ok" : n <= 2 ? "warning" : "critical",
        });
      }
      setItems(list);
      loadingRef.current = false;
    });
  }, [open, llmMode, hasProductionModel]);

  const hasAttention = (items ?? []).some((i) => i.severity === "warning" || i.severity === "critical");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label="Notifications">
          <Bell className="size-4" />
          {hasAttention && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-sm font-medium">System signals</p>
          <p className="text-xs text-muted-foreground">Live operational status for this workspace</p>
        </div>
        <div className="lm-scroll max-h-80 overflow-y-auto p-1.5">
          {items === null ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading signals…</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex items-start gap-2.5 rounded-md px-2.5 py-2">
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    item.severity === "ok" && "bg-emerald-500",
                    item.severity === "info" && "bg-[var(--lm-info)]",
                    item.severity === "warning" && "bg-amber-500",
                    item.severity === "critical" && "bg-rose-500",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Global command palette ───────────────────────────────────────────────────

interface LeadHit {
  id: string;
  companyName: string;
  contactName: string;
}

function GlobalPalette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: () => void;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const [query, setQuery] = useState("");
  const [leadHits, setLeadHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const reqRef = useRef(0);

  // Debounced live lead search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setLeadHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      const reqId = ++reqRef.current;
      setSearching(true);
      try {
        const res = await api<{ items: LeadHit[] }>(`/api/leads?query=${encodeURIComponent(q)}&pageSize=8`);
        if (reqId !== reqRef.current) return;
        setLeadHits(res.items ?? []);
      } catch {
        if (reqId === reqRef.current) setLeadHits([]);
      } finally {
        if (reqId === reqRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setLeadHits([]);
    }
  }, [open]);

  const go = (fn: () => void) => {
    onNavigate();
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Global search" description="Search sections and leads">
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search sections and leads…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>{searching ? "Searching leads…" : "No results found."}</CommandEmpty>
        {leadHits.length > 0 && (
          <CommandGroup heading="Leads">
            {leadHits.map((lead) => (
              <CommandItem
                key={lead.id}
                value={`lead-${lead.companyName}-${lead.contactName}-${lead.id}`}
                onSelect={() => go(() => navigate("lead", { leadId: lead.id }))}
              >
                <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">
                  <span className="font-medium">{lead.companyName}</span>
                  <span className="text-muted-foreground"> · {lead.contactName}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {ALL_NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.key}
              value={`nav-${item.label}`}
              onSelect={() => go(() => navigate(item.key))}
            >
              <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
