"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Activity, ArrowRight, Factory, ListChecks, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, fmtDate, fmtRelative, type DashboardData } from "@/lib/api";
import { EmptyState, LoadingCards, PageHeader, PriorityBadge, StatCard } from "@/components/lm/shared";
import { useAppStore, type SessionData } from "@/lib/store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Local types ──────────────────────────────────────────────────────────────

interface TrendWeek {
  label: string;
  newLeads: number;
  events: number;
  pricingVisits: number;
  avgIntent: number | null;
  avgFit: number | null;
}

interface DashboardPayload {
  data: DashboardData;
  weeks: TrendWeek[];
}

interface PipelineDatum {
  name: string;
  value: number;
  color: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

// ── Formatting helpers ───────────────────────────────────────────────────────

function prettifyAction(action: string): string {
  const s = action.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function fmtScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function fmtMetric(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function fmtConversion(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function activityDotColor(type: string): string {
  if (type === "EVENT") return "bg-emerald-500";
  if (type === "OUTCOME") return "bg-violet-500";
  return "bg-zinc-400";
}

// ── Building blocks ──────────────────────────────────────────────────────────

function PanelCard({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("p-0 gap-0", className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function ModelMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function DashboardView({ session }: { session: SessionData }) {
  const navigate = useAppStore((s) => s.navigate);

  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    async function run() {
      try {
        const [dashboard, trends] = await Promise.all([
          api<DashboardData>("/api/analytics/dashboard"),
          api<{ weeks: TrendWeek[] }>("/api/analytics/trends"),
        ]);
        if (cancelled) return;
        setPayload({ data: dashboard, weeks: trends.weeks });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        if (!cancelled) setPending(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const data = payload?.data ?? null;
  const weeks = payload?.weeks ?? null;
  const refreshing = pending && payload !== null;

  const pipelineData = useMemo<PipelineDatum[]>(() => {
    if (!data) return [];
    return [
      { name: "Sales Ready", value: data.counts.salesReady, color: "#10b981" },
      { name: "Nurture", value: data.counts.nurture, color: "#f59e0b" },
      { name: "Keep Warm", value: data.counts.keepWarm, color: "#a1a1aa" },
      { name: "Manual Review", value: data.counts.manualReview, color: "#f43f5e" },
    ];
  }, [data]);

  const sortedIndustries = useMemo(() => {
    if (!data) return [];
    return [...data.industries].sort((a, b) => {
      if (a.conversionRate === null && b.conversionRate === null) return b.leads - a.leads;
      if (a.conversionRate === null) return 1;
      if (b.conversionRate === null) return -1;
      return b.conversionRate - a.conversionRate;
    });
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intelligence Command Center"
        description={`Live pipeline intelligence for ${session.workspace.name}`}
        actions={
          <>
            {data && (
              <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", data.llmMode === "live" ? "bg-emerald-500" : "bg-zinc-400")}
                  aria-hidden="true"
                />
                {data.llmMode === "live" ? "LLM live" : "LLM demo"}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={refresh} disabled={pending} aria-label="Refresh dashboard data">
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
          </>
        }
      />

      {error && data && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Refresh failed</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Retry dashboard refresh">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {pending && !data ? (
        <LoadingCards count={6} />
      ) : error && !data ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Failed to load dashboard data</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={refresh} aria-label="Retry loading dashboard">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : data && weeks ? (
        <>
          {/* ── KPI row ─────────────────────────────────────────────────── */}
          <section aria-label="Key performance indicators" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard title="Total leads" value={data.counts.leads} hint={`${data.counts.activeLeads} active`} />
            <StatCard title="Sales Ready" value={data.counts.salesReady} tone="brand" />
            <StatCard title="Nurture Track" value={data.counts.nurture} tone="warning" />
            <StatCard title="Avg fit" value={fmtScore(data.averages.fit)} />
            <StatCard title="Avg intent" value={fmtScore(data.averages.intent)} />
            <StatCard
              title="Predictions"
              value={data.counts.predictions}
              hint={`${data.conversionEstimate.predictedWinners} predicted winners`}
            />
          </section>

          {/* ── Charts row ──────────────────────────────────────────────── */}
          <section aria-label="Pipeline and engagement charts" className="grid gap-4 lg:grid-cols-2">
            <PanelCard title="Pipeline distribution" subtitle="Leads by qualification category">
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pipelineData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={36}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      allowDecimals={false}
                    />
                    <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} contentStyle={CHART_TOOLTIP_STYLE} />
                    <Bar dataKey="value" name="Leads" radius={[6, 6, 0, 0]} maxBarSize={44}>
                      {pipelineData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </PanelCard>

            <PanelCard
              title="Engagement trend (12 weeks)"
              subtitle="Weekly event volume and average intent score"
              actions={
                <div className="flex items-center gap-3" aria-hidden="true">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Events
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Avg intent
                  </span>
                </div>
              }
            >
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="lmTrendEvents" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="lmTrendIntent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.22} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                      allowDecimals={false}
                    />
                    <ChartTooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ stroke: "var(--border)" }} />
                    <Area type="monotone" dataKey="events" name="Events" stroke="#10b981" strokeWidth={2} fill="url(#lmTrendEvents)" />
                    <Area
                      type="monotone"
                      dataKey="avgIntent"
                      name="Avg intent"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="url(#lmTrendIntent)"
                      connectNulls
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </PanelCard>
          </section>

          {/* ── Recommendations + model status ──────────────────────────── */}
          <section aria-label="Recommended actions and model status" className="grid gap-4 lg:grid-cols-3">
            <PanelCard
              title="Recommended actions"
              subtitle="AI-generated next steps, highest priority first"
              className="lg:col-span-2"
            >
              {data.topRecommendations.length === 0 ? (
                <EmptyState
                  title="No pending recommendations"
                  description="Next-best actions will appear here as leads engage with your pipeline."
                  icon={<ListChecks className="size-6" aria-hidden="true" />}
                />
              ) : (
                <>
                  <ul className="mt-3 space-y-1">
                    {data.topRecommendations.slice(0, 5).map((rec) => (
                      <li key={rec.id}>
                        <button
                          type="button"
                          onClick={() => navigate("lead", { leadId: rec.leadId })}
                          aria-label={`${prettifyAction(rec.action)} — open lead ${rec.leadName}`}
                          className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-muted/60"
                        >
                          <PriorityBadge priority={rec.priority} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{prettifyAction(rec.action)}</span>
                              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {rec.leadName} · {rec.companyName}
                            </span>
                            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                              {truncate(rec.explanation, 110)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full text-muted-foreground"
                    onClick={() => navigate("actions")}
                    aria-label="Open action center"
                  >
                    View all in Action Center
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </>
              )}
            </PanelCard>

            <PanelCard title="Model status" subtitle="Conversion prediction engine">
              {data.modelStatus ? (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{data.modelStatus.algorithm}</p>
                      <p className="text-xs text-muted-foreground">Trained {fmtDate(data.modelStatus.trainedAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                        {data.modelStatus.versionTag}
                      </Badge>
                      <Badge className="bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Production
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border bg-muted/30">
                    <ModelMetric label="ROC-AUC" value={fmtMetric(data.modelStatus.rocAuc)} />
                    <ModelMetric label="PR-AUC" value={fmtMetric(data.modelStatus.prAuc)} />
                    <ModelMetric label="F1" value={fmtMetric(data.modelStatus.f1)} />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate("models")}
                    aria-label="Open model intelligence"
                  >
                    Open Model Intelligence
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
                    <TriangleAlert aria-hidden="true" />
                    <AlertTitle>No production model</AlertTitle>
                    <AlertDescription className="text-amber-800 dark:text-amber-300">
                      Train a model to enable conversion predictions.
                    </AlertDescription>
                  </Alert>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate("models")}
                    aria-label="Open model intelligence"
                  >
                    Open Model Intelligence
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </PanelCard>
          </section>

          {/* ── Industry performance + recent activity ──────────────────── */}
          <section aria-label="Industry performance and recent activity" className="grid gap-4 lg:grid-cols-2">
            <PanelCard title="Industry performance" subtitle="Verticals ranked by conversion rate">
              {sortedIndustries.length === 0 ? (
                <EmptyState
                  title="No industry data yet"
                  description="Import leads with industry information to see vertical performance."
                  icon={<Factory className="size-6" aria-hidden="true" />}
                />
              ) : (
                <div className="lm-scroll mt-3 max-h-80 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Industry</TableHead>
                        <TableHead className="text-right">Leads</TableHead>
                        <TableHead className="text-right">Avg fit</TableHead>
                        <TableHead className="text-right">Avg intent</TableHead>
                        <TableHead className="text-right">Won/Lost</TableHead>
                        <TableHead className="text-right">Conversion %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedIndustries.map((row) => (
                        <TableRow key={row.industry}>
                          <TableCell className="max-w-36 truncate text-xs font-medium" title={row.industry}>
                            {row.industry}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{row.leads}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtScore(row.avgFit)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtScore(row.avgIntent)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {row.won}/{row.lost}
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium tabular-nums">
                            {fmtConversion(row.conversionRate)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </PanelCard>

            <PanelCard title="Recent activity" subtitle="Lead signals from the last 14 days">
              {data.activity.length === 0 ? (
                <EmptyState
                  title="No recent activity"
                  description="Events, outcomes, and signals will stream in here as leads engage."
                  icon={<Activity className="size-6" aria-hidden="true" />}
                />
              ) : (
                <ul className="lm-scroll mt-3 max-h-80 space-y-0.5 overflow-y-auto">
                  {data.activity.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => navigate("lead", { leadId: item.leadId })}
                        aria-label={`${item.label} — open lead`}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", activityDotColor(item.type))} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtRelative(item.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PanelCard>
          </section>
        </>
      ) : null}
    </div>
  );
}
