"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, ActivitySquare, Database, Gauge, RefreshCw, ShieldAlert, Stethoscope, TriangleAlert, Waves } from "lucide-react";
import { api, fmtDateTime, fmtRelative } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, StatCard } from "@/components/lm/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SessionData } from "@/lib/store";

// ── Types ────────────────────────────────────────────────────────────────────

interface ModelHealth {
  id: string;
  name: string;
  algorithm: string;
  versionTag: string;
  status: string;
  isProduction: boolean;
  trainedAt: string;
  metrics: {
    rocAuc: number;
    prAuc: number;
    f1: number | null;
    accuracy: number;
    brier: number;
    precision: number | null;
    recall: number;
  } | null;
}

interface DriftFeature {
  feature: string;
  label: string;
  psi: number;
  level: "STABLE" | "WARNING" | "ALERT";
}

interface DriftReport {
  status: "STABLE" | "WARNING" | "ALERT";
  scoredLeads: number;
  comparedAgainst: string | null;
  overallPsi: number;
  features: DriftFeature[];
}

interface QualityReport {
  totalLeads: number;
  missingFields: { field: string; count: number; pct: number }[];
  leadsWithoutEvents: number;
  staleLeads: number;
  duplicateEmails: { email: string; count: number }[];
  invalidEvents: number;
  issues: string[];
}

interface AgentStep {
  step: string;
  status: "OK" | "SKIPPED" | "ERROR";
  detail?: string;
  ms: number;
  cached?: boolean;
}

interface AgentRun {
  id: string;
  kind: string;
  trigger: string;
  status: string;
  steps: AgentStep[];
  durationMs: number | null;
  startedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMetric(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(digits);
}

function driftBadgeClass(status: string): string {
  switch (status) {
    case "STABLE":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "WARNING":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "ALERT":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function psiBarClass(level: string): string {
  switch (level) {
    case "ALERT":
      return "[&>div]:bg-rose-500";
    case "WARNING":
      return "[&>div]:bg-amber-500";
    default:
      return "[&>div]:bg-emerald-500";
  }
}

function runStatusBadgeClass(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "FAILED":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
    case "RUNNING":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function stepDotClass(status: string): string {
  switch (status) {
    case "OK":
      return "bg-emerald-500";
    case "ERROR":
      return "bg-rose-500";
    default:
      return "bg-zinc-400";
  }
}

// ── Main view ────────────────────────────────────────────────────────────────

export function MonitoringView({ session: _session }: { session: SessionData }) {
  const [models, setModels] = useState<ModelHealth[]>([]);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftAt, setDriftAt] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [modelsRes, driftRes, qualityRes, runsRes] = await Promise.all([
        api<{ models: ModelHealth[] }>("/api/models"),
        api<{ report: DriftReport; generatedAt: string }>("/api/monitoring/drift"),
        api<{ report: QualityReport }>("/api/monitoring/quality"),
        api<{ runs: AgentRun[] }>("/api/monitoring/agent-runs"),
      ]);
      setModels(modelsRes.models ?? []);
      setDrift(driftRes.report ?? null);
      setDriftAt(driftRes.generatedAt ?? null);
      setQuality(qualityRes.report ?? null);
      setRuns(runsRes.runs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monitoring data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const production = models.find((m) => m.isProduction) ?? null;
  const driftSeverity = drift?.status ?? "STABLE";
  const totalIssues = quality?.issues.length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Monitoring"
        description="Model health, data quality, feature drift (PSI) and agent activity — the operational picture behind the intelligence."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing} aria-label="Refresh monitoring data">
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Failed to load monitoring data</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* Health summary */}
          <section aria-label="Monitoring summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Model health"
              value={production ? production.status : "No model"}
              tone={production ? "brand" : "warning"}
              hint={production ? production.versionTag : "Train a model to enable predictions"}
              icon={<Stethoscope className="size-3.5" />}
            />
            <StatCard
              title="Feature drift"
              value={drift?.status ?? "—"}
              tone={driftSeverity === "STABLE" ? "brand" : driftSeverity === "WARNING" ? "warning" : "danger"}
              hint={drift ? `Overall PSI ${drift.overallPsi.toFixed(3)} · ${drift.scoredLeads} scored leads` : undefined}
              icon={<Waves className="size-3.5" />}
            />
            <StatCard
              title="Data quality issues"
              value={totalIssues}
              tone={totalIssues === 0 ? "brand" : totalIssues <= 2 ? "warning" : "danger"}
              hint={quality ? `${quality.totalLeads} leads scanned` : undefined}
              icon={<Database className="size-3.5" />}
            />
            <StatCard
              title="Agent runs (recent)"
              value={runs.length}
              tone="info"
              hint={runs[0] ? `Last run ${fmtRelative(runs[0].startedAt)}` : "No runs recorded"}
              icon={<ActivitySquare className="size-3.5" />}
            />
          </section>

          {/* Model health */}
          <Card className="lm-panel p-0 gap-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Stethoscope className="size-4 text-[var(--lm-brand)]" aria-hidden="true" />
                <p className="lm-card-title">Model health</p>
                {production && (
                  <Badge variant="outline" className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {production.versionTag}
                  </Badge>
                )}
              </div>
              {production ? (
                <>
                  <div className="mt-3 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border bg-muted/30 md:grid-cols-6">
                    {[
                      { label: "ROC-AUC", value: fmtMetric(production.metrics?.rocAuc) },
                      { label: "PR-AUC", value: fmtMetric(production.metrics?.prAuc) },
                      { label: "F1", value: fmtMetric(production.metrics?.f1) },
                      { label: "Accuracy", value: fmtMetric(production.metrics?.accuracy) },
                      { label: "Precision", value: fmtMetric(production.metrics?.precision) },
                      { label: "Brier", value: fmtMetric(production.metrics?.brier) },
                    ].map((m) => (
                      <div key={m.label} className="px-3 py-2.5 text-center">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums">{m.value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {production.algorithm.replaceAll("_", " ")} · trained {fmtDateTime(production.trainedAt)} · evaluation metrics are computed on held-out test data, not guaranteed real-world performance.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No production model. Train and activate one in Model Intelligence — monitoring of predictions and drift activates automatically afterwards.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Drift / PSI */}
            <Card className="lm-panel p-0 gap-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Waves className="size-4 text-[var(--lm-info)]" aria-hidden="true" />
                  <p className="lm-card-title">Feature drift (PSI)</p>
                  {drift && <Badge className={cn("ml-auto font-medium", driftBadgeClass(drift.status))}>{drift.status}</Badge>}
                </div>
                {!drift ? (
                  <p className="mt-2 text-sm text-muted-foreground">No drift report available yet.</p>
                ) : drift.features.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {drift.scoredLeads >= 20
                      ? "PSI comparison unavailable — the production model has no stored training reference distribution. It will be computed on the next training run."
                      : `Not enough scored leads in the last 60 days to compute a stable PSI comparison (${drift.scoredLeads} so far, needs 20+).`}
                  </p>
                ) : (
                  <>
                    <div className="mt-3 space-y-2.5">
                      {drift.features.map((f) => (
                        <div key={f.feature} className="flex items-center gap-3">
                          <span className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={f.label}>
                            {f.label}
                          </span>
                          <Progress value={Math.min(100, f.psi * 200)} className={cn("h-1.5 flex-1", psiBarClass(f.level))} aria-label={`${f.label} PSI ${f.psi}`} />
                          <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums">{f.psi.toFixed(3)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      PSI &lt; 0.10 stable · 0.10–0.25 warning · &gt; 0.25 alert. {drift.scoredLeads} leads compared
                      {drift.comparedAgainst ? ` against ${drift.comparedAgainst}` : ""}
                      {driftAt ? ` · generated ${fmtRelative(driftAt)}` : ""}.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Data quality */}
            <Card className="lm-panel p-0 gap-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Database className="size-4 text-[var(--lm-brand)]" aria-hidden="true" />
                  <p className="lm-card-title">Data quality</p>
                </div>
                {!quality ? (
                  <p className="mt-2 text-sm text-muted-foreground">No quality report available.</p>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[
                        { label: "No events", value: quality.leadsWithoutEvents, tone: "warning" as const },
                        { label: "Stale (60d+)", value: quality.staleLeads, tone: "warning" as const },
                        { label: "Invalid events", value: quality.invalidEvents, tone: quality.invalidEvents > 0 ? ("danger" as const) : ("brand" as const) },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg border bg-muted/30 p-2.5 text-center">
                          <p className="text-lg font-semibold tabular-nums">{s.value}</p>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                        </div>
                      ))}
                    </div>
                    {quality.missingFields.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {quality.missingFields.slice(0, 5).map((m) => (
                          <div key={m.field} className="flex items-center gap-3">
                            <span className="w-32 shrink-0 truncate text-xs capitalize text-muted-foreground">{m.field.replaceAll("_", " ")}</span>
                            <Progress value={m.pct} className="h-1.5 flex-1 [&>div]:bg-amber-500" aria-label={`${m.field} missing ${m.pct}%`} />
                            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{m.pct}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {quality.issues.length > 0 && (
                      <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                          <ShieldAlert className="size-3.5" aria-hidden="true" />
                          {quality.issues.length} issue{quality.issues.length === 1 ? "" : "s"} detected
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {quality.issues.slice(0, 6).map((issue, i) => (
                            <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {quality.duplicateEmails.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Duplicate emails: {quality.duplicateEmails.slice(0, 3).map((d) => `${d.email} ×${d.count}`).join(", ")}
                        {quality.duplicateEmails.length > 3 ? ` +${quality.duplicateEmails.length - 3} more` : ""}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agent runs */}
          <Card className="lm-panel p-0 gap-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-[var(--lm-info)]" aria-hidden="true" />
                <p className="lm-card-title">Agent runs</p>
                <span className="ml-auto text-xs text-muted-foreground">Latest {runs.length}</span>
              </div>
              {runs.length === 0 ? (
                <EmptyState title="No agent runs recorded" description="Agent runs appear here after lead assessments or copilot analyses execute." icon={<Gauge className="size-6" aria-hidden="true" />} />
              ) : (
                <div className="lm-scroll mt-3 max-h-96 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Kind</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Steps</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead>Started</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-xs font-medium">{run.kind.replaceAll("_", " ").toLowerCase()}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{run.trigger.replaceAll("_", " ").toLowerCase()}</TableCell>
                          <TableCell>
                            <Badge className={cn("font-medium", runStatusBadgeClass(run.status))}>{run.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            <span className="inline-flex items-center gap-1" title={run.steps.map((s) => `${s.step}: ${s.status}`).join("\n")}>
                              {run.steps.slice(0, 5).map((s, i) => (
                                <span key={i} className={cn("h-1.5 w-1.5 rounded-full", stepDotClass(s.status))} aria-hidden="true" />
                              ))}
                              {run.steps.length > 5 && <span className="text-muted-foreground">+{run.steps.length - 5}</span>}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                            {run.durationMs === null ? "—" : `${(run.durationMs / 1000).toFixed(2)}s`}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtDateTime(run.startedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
