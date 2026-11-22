"use client";

export interface LeadRowClient {
  id: string;
  contactName: string;
  companyName: string;
  industry: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  dealValue: number | null;
  employeeCount: number | null;
  revenueBand: string | null;
  country: string | null;
  businessModel: string | null;
  createdAt: string;
  updatedAt: string;
  fit: number | null;
  intent: number | null;
  probability: number | null;
  qualification: { category: string; source: string; reasons: string[] } | null;
  lastEventAt: string | null;
  eventCount: number;
  topAction: string | null;
  topActionPriority: string | null;
}

export interface DashboardData {
  counts: { leads: number; activeLeads: number; salesReady: number; nurture: number; keepWarm: number; manualReview: number; predictions: number };
  averages: { fit: number | null; intent: number | null };
  conversionEstimate: { predictedWinners: number; totalProbability: number };
  activity: { id: string; type: string; label: string; leadId: string; at: string }[];
  topRecommendations: { id: string; leadId: string; leadName: string; companyName: string; action: string; priority: string; explanation: string }[];
  modelStatus: { id: string; algorithm: string; versionTag: string; trainedAt: string; rocAuc: number | null; prAuc: number | null; f1: number | null } | null;
  industries: { industry: string; leads: number; avgFit: number | null; avgIntent: number | null; won: number; lost: number; conversionRate: number | null }[];
  llmMode: "live" | "demo";
}

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function qualColor(category: string | null | undefined): string {
  switch (category) {
    case "SALES_READY":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "NURTURE_TRACK":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "KEEP_WARM":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "MANUAL_REVIEW":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function qualLabel(category: string | null | undefined): string {
  switch (category) {
    case "SALES_READY":
      return "Sales Ready";
    case "NURTURE_TRACK":
      return "Nurture Track";
    case "KEEP_WARM":
      return "Keep Warm";
    case "MANUAL_REVIEW":
      return "Manual Review";
    default:
      return "Not assessed";
  }
}

export function priorityColor(priority: string | null | undefined): string {
  switch (priority) {
    case "CRITICAL":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
    case "HIGH":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "MEDIUM":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}
