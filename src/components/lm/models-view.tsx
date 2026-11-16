"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BrainCircuit,
  Eye,
  Info,
  Loader2,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import { Tooltip as ChartTooltip, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, fmtDate, fmtDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, StatCard } from "@/components/lm/shared";
import type { SessionData } from "@/lib/store";

// ── API payload interfaces ───────────────────────────────────────────────────

interface ModelMetrics {
  threshold: number;
  precision: number | null;
  recall: number;
  f1: number | null;
  accuracy: number;
  rocAuc: number;
  prAuc: number;
  brier: number;
}

interface TrainInfo {
  totalRows: number;
  syntheticRows: number;
  realOutcomeRows: number;
  positives: number;
  negatives: number;
  featureNames: string[];
  isSyntheticDominant: boolean;
}

interface ModelListItem {
  id: string;
  name: string;
  algorithm: string;
  versionTag: string;
  status: string;
  isProduction: boolean;
  trainedAt: string;
  params: Record<string, number>;
  metrics: ModelMetrics | null;
  trainInfo: TrainInfo | null;
}

interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

interface CalibrationBin {
  bin: string;
  count: number;
  avgPredicted: number;
  observedRate: number | null;
}

interface EvalBundle {
  threshold: number;
  precision: number | null;
  recall: number;
  f1: number | null;
  accuracy: number;
  rocAuc: number;
  prAuc: number;
  brier: number;
  confusion: Confusion;
  calibration: CalibrationBin[];
}

interface ComparisonRow {
  algorithm: string;
  valPrAuc: number;
  valRocAuc: number;
  testRocAuc: number;
  testPrAuc: number;
  testF1: number | null;
}

interface TrainResponse {
  ok: boolean;
  best: { algorithm: string; test: EvalBundle; val: EvalBundle; featureImportance: number[] };
  comparison: ComparisonRow[];
  dataset: { totalRows: number; syntheticRows: number; realOutcomeRows: number; isSyntheticDominant: boolean };
  drift: { status: string; scoredLeads: number };
  modelIds: string[];
}

interface FeatureImportanceRow {
  feature: string;
  label: string;
  importance: number;
}

interface ModelDetail {
  id: string;
  name: string;
  algorithm: string;
  versionTag: string;
  status: string;
  isProduction: boolean;
  trainedAt: string;
  params: Record<string, number>;
  trainInfo: TrainInfo | null;
  featureImportance: FeatureImportanceRow[];
}

interface ModelEvaluation {
  split: string;
  metrics: ModelMetrics;
  confusion: Confusion;
  calibration: CalibrationBin[];
}

interface ModelDetailResponse {
  ok: boolean;
  model: ModelDetail;
  evaluations: ModelEvaluation[];
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

interface MonitoringBundle {
  drift: DriftReport;
  quality: QualityReport;
  runs: AgentRun[];
}

// ── Small helpers ────────────────────────────────────────────────────────────

const CHART_TOOLTIP = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } as const;

function fmtMetric(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(digits);
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "PRODUCTION":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "READY":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "FAILED":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
    default:
      return "bg-muted text-muted-foreground";
  }
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

function runStatusClass(status: string): string {
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

function AdminOnlyTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-not-allowed">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>Admin only</TooltipContent>
    </Tooltip>
  );
}

// ── Confusion matrix + calibration ───────────────────────────────────────────

function ConfusionMatrix({ confusion }: { confusion: Confusion }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Confusion matrix</p>
      <div className="inline-grid grid-cols-[auto_1fr_1fr] gap-1 text-xs">
        <div />
        <div className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">Pred +</div>
        <div className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">Pred −</div>
        <div className="flex items-center text-[10px] uppercase tracking-wide text-muted-foreground">Act +</div>
        <div className="rounded-md bg-emerald-100 px-3 py-1.5 text-center dark:bg-emerald-950">
          <span className="block text-sm font-semibold tabular-nums">{confusion.tp}</span>
          <span className="text-[10px] text-emerald-700 dark:text-emerald-300">TP</span>
        </div>
        <div className="rounded-md bg-rose-100 px-3 py-1.5 text-center dark:bg-rose-950">
          <span className="block text-sm font-semibold tabular-nums">{confusion.fp}</span>
          <span className="text-[10px] text-rose-700 dark:text-rose-300">FP</span>
        </div>
        <div className="flex items-center text-[10px] uppercase tracking-wide text-muted-foreground">Act −</div>
        <div className="rounded-md bg-amber-100 px-3 py-1.5 text-center dark:bg-amber-950">
          <span className="block text-sm font-semibold tabular-nums">{confusion.fn}</span>
          <span className="text-[10px] text-amber-700 dark:text-amber-300">FN</span>
        </div>
        <div className="rounded-md bg-zinc-100 px-3 py-1.5 text-center dark:bg-zinc-800">
          <span className="block text-sm font-semibold tabular-nums">{confusion.tn}</span>
          <span className="text-[10px] text-zinc-600 dark:text-zinc-300">TN</span>
        </div>
      </div>
    </div>
  );
}

function CalibrationTable({ bins }: { bins: CalibrationBin[] }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Calibration by predicted-probability bin</p>
      <div className="max-h-44 overflow-y-auto rounded-md border lm-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 px-2 text-[11px]">Bin</TableHead>
              <TableHead className="h-7 px-2 text-[11px]">Count</TableHead>
              <TableHead className="h-7 px-2 text-[11px]">Avg predicted</TableHead>
              <TableHead className="h-7 px-2 text-[11px]">Observed rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bins.map((b) => (
              <TableRow key={b.bin}>
                <TableCell className="px-2 py-1 text-xs tabular-nums">{b.bin}</TableCell>
                <TableCell className="px-2 py-1 text-xs tabular-nums">{b.count}</TableCell>
                <TableCell className="px-2 py-1 text-xs tabular-nums">{b.avgPredicted.toFixed(2)}</TableCell>
                <TableCell className="px-2 py-1 text-xs tabular-nums">
                  {b.observedRate === null ? "—" : b.observedRate.toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function EvaluationBlock({ evaluation }: { evaluation: ModelEvaluation }) {
  const m = evaluation.metrics;
  const cells: [string, string][] = [
    ["ROC-AUC", fmtMetric(m.rocAuc)],
    ["PR-AUC", fmtMetric(m.prAuc)],
    ["F1", fmtMetric(m.f1)],
    ["Accuracy", fmtMetric(m.accuracy)],
    ["Precision", fmtMetric(m.precision)],
    ["Recall", fmtMetric(m.recall)],
    ["Brier", fmtMetric(m.brier)],
    ["Threshold", fmtMetric(m.threshold, 2)],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            evaluation.split === "TEST" && "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300",
          )}
        >
          {evaluation.split === "VALIDATION" ? "Validation" : evaluation.split === "TEST" ? "Test" : evaluation.split}
        </Badge>
        <span className="text-xs text-muted-foreground">
          decision threshold {m.threshold.toFixed(2)} · {confusionTotal(evaluation.confusion)} scored rows
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded-md border px-2.5 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="text-sm font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ConfusionMatrix confusion={evaluation.confusion} />
        <CalibrationTable bins={evaluation.calibration} />
      </div>
    </div>
  );
}

function confusionTotal(c: Confusion): number {
  return c.tp + c.fp + c.tn + c.fn;
}

// ── Feature importance chart ─────────────────────────────────────────────────

function FeatureImportanceChart({ rows }: { rows: FeatureImportanceRow[] }) {
  const top = [...rows].sort((a, b) => b.importance - a.importance).slice(0, 8);
  if (top.length === 0) {
    return <EmptyState title="No feature importance recorded" description="This model artifact does not include importance scores." />;
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            width={170}
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={CHART_TOOLTIP}
            formatter={(v) => [typeof v === "number" ? v.toFixed(4) : String(v), "Importance"]}
          />
          <Bar dataKey="importance" fill="#10b981" radius={[0, 4, 4, 0]} barSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function ModelsView({ session }: { session: SessionData }) {
  const isAdmin = session.user.role === "ADMIN";

  const [tab, setTab] = useState("models");

  const [models, setModels] = useState<ModelListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [training, setTraining] = useState(false);
  const [trainResult, setTrainResult] = useState<TrainResponse | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModelDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [activateTarget, setActivateTarget] = useState<ModelListItem | null>(null);
  const [activating, setActivating] = useState(false);

  const [mon, setMon] = useState<MonitoringBundle | null>(null);
  const [monLoading, setMonLoading] = useState(false);
  const [monError, setMonError] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; models: ModelListItem[] }>("/api/models");
      setModels(res.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMonitoring = useCallback(async () => {
    setMonLoading(true);
    setMonError(null);
    try {
      const [driftRes, qualityRes, runsRes] = await Promise.all([
        api<{ ok: boolean; report: DriftReport }>("/api/monitoring/drift"),
        api<{ ok: boolean; report: QualityReport }>("/api/monitoring/quality"),
        api<{ ok: boolean; runs: AgentRun[] }>("/api/monitoring/agent-runs"),
      ]);
      setMon({ drift: driftRes.report, quality: qualityRes.report, runs: runsRes.runs });
    } catch (e) {
      setMonError(e instanceof Error ? e.message : "Failed to load monitoring data");
    } finally {
      setMonLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "monitoring") void loadMonitoring();
  }, [tab, loadMonitoring]);

  // Fetch model details whenever the dialog target changes
  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    api<ModelDetailResponse>(`/api/models/${detailId}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : "Failed to load model details");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  const production = useMemo(() => models?.find((m) => m.isProduction) ?? null, [models]);

  const train = useCallback(async () => {
    setTraining(true);
    try {
      const res = await api<TrainResponse>("/api/models", { method: "POST", body: {} });
      setTrainResult(res);
      toast.success(`Best: ${res.best.algorithm} (PR-AUC ${res.best.val.prAuc.toFixed(3)})`, {
        description: `Trained ${res.modelIds.length} models on ${res.dataset.totalRows} rows · drift ${res.drift.status}`,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Training failed");
    } finally {
      setTraining(false);
    }
  }, [load]);

  const activate = useCallback(async () => {
    if (!activateTarget) return;
    setActivating(true);
    try {
      const res = await api<{ ok: boolean; id: string; algorithm: string; versionTag: string }>(
        `/api/models/${activateTarget.id}/activate`,
        { method: "POST", body: {} },
      );
      toast.success(`${res.algorithm} ${res.versionTag} is now the production model`);
      setActivateTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Activation failed");
    } finally {
      setActivating(false);
    }
  }, [activateTarget, load]);

  const trainButton = (
    <Button onClick={() => void train()} disabled={training} size="sm">
      {training ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BrainCircuit className="h-4 w-4" aria-hidden />}
      {training ? "Training…" : "Train models"}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Intelligence"
        description="Train, compare and monitor the conversion models behind LeadMind's predictions."
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Model Intelligence sections">
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
        </TabsList>

        {/* ── Models tab ─────────────────────────────────────────────────── */}
        <TabsContent value="models" className="space-y-4">
          {error && models === null ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>Could not load models</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{error}</span>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : loading && models === null ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-0 gap-0">
                    <CardContent className="p-4 space-y-2">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-7 w-16" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title="Production model"
                  value={production ? production.algorithm.replaceAll("_", " ") : "None"}
                  hint={production ? production.versionTag : "Train a model to activate one"}
                />
                <StatCard title="Test ROC-AUC" value={fmtMetric(production?.metrics?.rocAuc)} hint="Held-out test split" tone="brand" />
                <StatCard title="Test PR-AUC" value={fmtMetric(production?.metrics?.prAuc)} hint="Held-out test split" />
                <StatCard title="Test F1" value={fmtMetric(production?.metrics?.f1)} hint="Held-out test split" />
              </div>

              {/* Dataset provenance */}
              {production?.trainInfo && (
                production.trainInfo.isSyntheticDominant ? (
                  <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    <AlertTitle>Demo dataset</AlertTitle>
                    <AlertDescription>
                      {production.trainInfo.syntheticRows} synthetic + {production.trainInfo.realOutcomeRows} real outcome rows —
                      metrics are NOT real-world performance. Never present these numbers as production accuracy.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <Info className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <AlertTitle>Dataset provenance</AlertTitle>
                    <AlertDescription>
                      Trained on {production.trainInfo.realOutcomeRows} verified real outcome rows with{" "}
                      {production.trainInfo.syntheticRows} synthetic augmentation rows ({production.trainInfo.totalRows} total,{" "}
                      {production.trainInfo.positives} positives / {production.trainInfo.negatives} negatives).
                    </AlertDescription>
                  </Alert>
                )
              )}
              {!production && (
                <Alert>
                  <Info className="h-4 w-4" aria-hidden />
                  <AlertTitle>No production model</AlertTitle>
                  <AlertDescription>
                    Train the model suite below, then activate the best candidate to power conversion predictions.
                  </AlertDescription>
                </Alert>
              )}

              {/* Models table */}
              <Card className="p-0 gap-0">
                <CardHeader className="px-4 pt-4 pb-3">
                  <CardTitle className="text-sm">Model versions</CardTitle>
                  <CardDescription className="text-xs">
                    Metrics shown are from the held-out test split of each model.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 pb-2">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Algorithm</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">ROC-AUC</TableHead>
                        <TableHead className="text-right">PR-AUC</TableHead>
                        <TableHead className="text-right">F1</TableHead>
                        <TableHead>Trained</TableHead>
                        <TableHead className="w-10 pr-4" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {models && models.length > 0 ? (
                        models.map((m) => (
                          <TableRow key={m.id} className={cn(training && "pointer-events-none opacity-60")}>
                            <TableCell className="pl-4 font-medium">{m.algorithm.replaceAll("_", " ")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{m.versionTag}</TableCell>
                            <TableCell>
                              <Badge className={cn("font-medium", statusBadgeClass(m.status))}>{m.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMetric(m.metrics?.rocAuc)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMetric(m.metrics?.prAuc)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtMetric(m.metrics?.f1)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDate(m.trainedAt)}</TableCell>
                            <TableCell className="pr-4 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${m.algorithm} ${m.versionTag}`}>
                                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    className="cursor-pointer"
                                    disabled={training}
                                    onClick={() => setDetailId(m.id)}
                                  >
                                    <Eye className="h-4 w-4" aria-hidden /> View details
                                  </DropdownMenuItem>
                                  {isAdmin ? (
                                    m.isProduction ? null : (
                                      <DropdownMenuItem
                                        className="cursor-pointer"
                                        disabled={training}
                                        onClick={() => setActivateTarget(m)}
                                      >
                                        <BrainCircuit className="h-4 w-4" aria-hidden /> Activate as production
                                      </DropdownMenuItem>
                                    )
                                  ) : (
                                    <>
                                      <DropdownMenuSeparator />
                                      <AdminOnlyTooltip>
                                        <DropdownMenuItem disabled className="cursor-pointer">
                                          <BrainCircuit className="h-4 w-4" aria-hidden /> Activate as production
                                        </DropdownMenuItem>
                                      </AdminOnlyTooltip>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={8}>
                            <EmptyState
                              title="No models trained yet"
                              description="Run training below to fit logistic regression, random forest and gradient boosting candidates."
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Training card */}
              <Card className="p-0 gap-0">
                <CardHeader className="px-4 pt-4 pb-3">
                  <CardTitle className="text-sm">Training</CardTitle>
                  <CardDescription className="text-xs">
                    Fits three algorithm families — logistic regression, random forest and gradient boosting — on a
                    leakage-safe train/validation/test split. The best candidate is selected on validation, then final
                    metrics are computed on the untouched test set before promotion to production.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin ? (
                      trainButton
                    ) : (
                      <AdminOnlyTooltip>
                        <Button size="sm" disabled aria-label="Train models (admin only)">
                          <BrainCircuit className="h-4 w-4" aria-hidden /> Train models
                        </Button>
                      </AdminOnlyTooltip>
                    )}
                    {training && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Fitting candidates and evaluating splits — this takes a few seconds…
                      </span>
                    )}
                  </div>

                  {trainResult && (
                    <div className="rounded-lg border">
                      <div className="flex items-center justify-between px-3 py-2">
                        <p className="text-xs font-medium">
                          Comparison — selected{" "}
                          <span className="text-emerald-600 dark:text-emerald-400">{trainResult.best.algorithm.replaceAll("_", " ")}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          dataset {trainResult.dataset.totalRows} rows · {trainResult.dataset.realOutcomeRows} real outcomes · drift {trainResult.drift.status}
                        </p>
                      </div>
                      <div className="border-t">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-3">Algorithm</TableHead>
                              <TableHead className="text-right">Val PR-AUC</TableHead>
                              <TableHead className="text-right">Val ROC-AUC</TableHead>
                              <TableHead className="text-right">Test ROC-AUC</TableHead>
                              <TableHead className="text-right">Test PR-AUC</TableHead>
                              <TableHead className="pr-3 text-right">Test F1</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {trainResult.comparison.map((c) => (
                              <TableRow key={c.algorithm} className={cn(c.algorithm === trainResult.best.algorithm && "bg-emerald-500/5")}>
                                <TableCell className="pl-3 text-xs font-medium">{c.algorithm.replaceAll("_", " ")}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums">{fmtMetric(c.valPrAuc)}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums">{fmtMetric(c.valRocAuc)}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums">{fmtMetric(c.testRocAuc)}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums">{fmtMetric(c.testPrAuc)}</TableCell>
                                <TableCell className="pr-3 text-right text-xs tabular-nums">{fmtMetric(c.testF1)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Monitoring tab ─────────────────────────────────────────────── */}
        <TabsContent value="monitoring" className="space-y-4">
          {monError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>Could not load monitoring data</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{monError}</span>
                <Button variant="outline" size="sm" onClick={() => void loadMonitoring()}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : monLoading && !mon ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className={cn("h-64 rounded-xl", i === 2 && "lg:col-span-2")} />
              ))}
            </div>
          ) : !mon ? null : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Drift */}
              <Card className="p-0 gap-0">
                <CardHeader className="px-4 pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Feature drift (PSI)</CardTitle>
                    <Badge className={cn("font-medium", driftBadgeClass(mon.drift.status))}>{mon.drift.status}</Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {mon.drift.scoredLeads} scored leads vs {mon.drift.comparedAgainst ?? "no reference model"} · overall PSI{" "}
                    <span className="tabular-nums font-medium text-foreground">{mon.drift.overallPsi.toFixed(4)}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {mon.drift.features.length === 0 ? (
                    <EmptyState title="No drift data" description="Drift needs scored leads to compare against the training reference." />
                  ) : (
                    <ul className="space-y-2.5 max-h-80 overflow-y-auto lm-scroll pr-1">
                      {mon.drift.features.map((f) => (
                        <li key={f.feature} className="flex items-center gap-2 text-xs">
                          <span className="w-44 shrink-0 truncate text-muted-foreground" title={f.label}>
                            {f.label}
                          </span>
                          <Progress value={Math.min(100, f.psi * 100)} className={cn("h-1.5 flex-1", psiBarClass(f.level))} aria-label={`PSI for ${f.label}`} />
                          <span className="w-14 shrink-0 text-right tabular-nums">{f.psi.toFixed(3)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Data quality */}
              <Card className="p-0 gap-0">
                <CardHeader className="px-4 pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Data quality</CardTitle>
                    <span className="text-xs text-muted-foreground">{mon.quality.totalLeads} leads scanned</span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                      {mon.quality.leadsWithoutEvents} without events
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{mon.quality.staleLeads} stale</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{mon.quality.invalidEvents} invalid events</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                      {mon.quality.duplicateEmails.length} duplicate email groups
                    </span>
                  </div>

                  {mon.quality.issues.length > 0 && (
                    <ul className="space-y-1.5">
                      {mon.quality.issues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {mon.quality.missingFields.length > 0 && (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-7 pl-3 text-[11px]">Field</TableHead>
                            <TableHead className="h-7 text-[11px]">Missing</TableHead>
                            <TableHead className="h-7 pr-3 text-[11px]">Share</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mon.quality.missingFields.map((f) => (
                            <TableRow key={f.field}>
                              <TableCell className="py-1.5 pl-3 text-xs font-medium">{f.field}</TableCell>
                              <TableCell className="py-1.5 text-xs tabular-nums">{f.count}</TableCell>
                              <TableCell className="py-1.5 pr-3">
                                <div className="flex items-center gap-2">
                                  <Progress value={f.pct} className={cn("h-1.5 w-24", f.pct > 50 ? "[&>div]:bg-rose-500" : "[&>div]:bg-amber-500")} aria-label={`${f.field} missing ${f.pct}%`} />
                                  <span className="text-xs tabular-nums text-muted-foreground">{f.pct.toFixed(0)}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Agent runs */}
              <Card className="p-0 gap-0 lg:col-span-2">
                <CardHeader className="px-4 pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Agent runs</CardTitle>
                    <span className="text-xs text-muted-foreground">last {Math.min(10, mon.runs.length)} of {mon.runs.length}</span>
                  </div>
                  <CardDescription className="text-xs">Click a row to expand its step-by-step trace.</CardDescription>
                </CardHeader>
                <CardContent className="p-0 pb-2">
                  {mon.runs.length === 0 ? (
                    <EmptyState title="No agent runs yet" description="Agent runs appear here after assessments and copilot activity." />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Kind</TableHead>
                          <TableHead>Trigger</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Duration</TableHead>
                          <TableHead>Started</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mon.runs.slice(0, 10).map((r) => {
                          const open = expandedRuns[r.id] === true;
                          return (
                            <Fragment key={r.id}>
                              <TableRow
                                onClick={() => setExpandedRuns((prev) => ({ ...prev, [r.id]: !open }))}
                                className="cursor-pointer"
                                aria-expanded={open}
                              >
                                <TableCell className="pl-4">
                                  <Badge variant="outline" className="font-medium">
                                    {r.kind === "CONVERSATIONAL" ? "Conversational" : "Analytical"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{r.trigger.replaceAll("_", " ")}</TableCell>
                                <TableCell>
                                  <Badge className={cn("font-medium", runStatusClass(r.status))}>{r.status}</Badge>
                                </TableCell>
                                <TableCell className="text-right text-xs tabular-nums">
                                  {r.durationMs === null ? "—" : `${r.durationMs} ms`}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.startedAt)}</TableCell>
                              </TableRow>
                              {open && (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={5} className="border-t bg-muted/40 p-0">
                                    <div className="px-4 py-2">
                                      {r.steps.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No steps recorded for this run.</p>
                                      ) : (
                                        <ol className="space-y-1">
                                          {r.steps.map((s, i) => (
                                            <li key={i} className="flex items-center gap-2 text-xs">
                                              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stepDotClass(s.status))} aria-hidden />
                                              <span className="font-medium">{s.step}</span>
                                              <span className="text-muted-foreground">{s.status}</span>
                                              {s.detail && <span className="truncate text-muted-foreground">· {s.detail}</span>}
                                              {s.cached && (
                                                <span className="rounded bg-zinc-100 px-1 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                                  cached
                                                </span>
                                              )}
                                              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{s.ms} ms</span>
                                            </li>
                                          ))}
                                        </ol>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Model details dialog ────────────────────────────────────────── */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto lm-scroll">
          <DialogHeader>
            <DialogTitle className="text-base">
              {detail ? `${detail.model.algorithm.replaceAll("_", " ")} — ${detail.model.versionTag}` : "Model details"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {detail ? `Trained ${fmtDate(detail.model.trainedAt)} · ${detail.model.status}` : "Loading model details…"}
            </DialogDescription>
          </DialogHeader>

          {detailLoading && (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}

          {detailError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>Could not load model details</AlertTitle>
              <AlertDescription>{detailError}</AlertDescription>
            </Alert>
          )}

          {detail && (
            <div className="space-y-5">
              {/* Hyperparameters */}
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hyperparameters</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(detail.model.params).map(([k, v]) => (
                    <span key={k} className="rounded-md border px-2 py-0.5 text-xs">
                      <span className="text-muted-foreground">{k}</span> <span className="font-medium tabular-nums">{v}</span>
                    </span>
                  ))}
                  {Object.keys(detail.model.params).length === 0 && (
                    <span className="text-xs text-muted-foreground">No recorded hyperparameters.</span>
                  )}
                </div>
              </section>

              {/* Train info */}
              {detail.model.trainInfo && (
                <section className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Training data</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {[
                      ["Total rows", detail.model.trainInfo.totalRows],
                      ["Real outcome rows", detail.model.trainInfo.realOutcomeRows],
                      ["Synthetic rows", detail.model.trainInfo.syntheticRows],
                      ["Positives", detail.model.trainInfo.positives],
                      ["Negatives", detail.model.trainInfo.negatives],
                      ["Features", detail.model.trainInfo.featureNames.length],
                    ].map(([k, v]) => (
                      <div key={String(k)} className="rounded-md border px-2.5 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
                        <p className="text-sm font-semibold tabular-nums">{v}</p>
                      </div>
                    ))}
                  </div>
                  {detail.model.trainInfo.isSyntheticDominant && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      Synthetic rows dominate this dataset — treat metrics as demonstration values only.
                    </p>
                  )}
                </section>
              )}

              {/* Evaluations per split */}
              <section className="space-y-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evaluations</p>
                {detail.evaluations.length === 0 ? (
                  <EmptyState title="No evaluations recorded" />
                ) : (
                  detail.evaluations
                    .slice()
                    .sort((a, b) => (a.split === "TEST" ? -1 : 1) - (b.split === "TEST" ? -1 : 1))
                    .map((ev, i) => <EvaluationBlock key={`${ev.split}-${i}`} evaluation={ev} />)
                )}
              </section>

              {/* Feature importance */}
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Feature importance (top 8)</p>
                <FeatureImportanceChart rows={detail.model.featureImportance} />
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Activate confirmation ───────────────────────────────────────── */}
      <AlertDialog open={activateTarget !== null} onOpenChange={(open) => !open && setActivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate as production?</AlertDialogTitle>
            <AlertDialogDescription>
              {activateTarget &&
                `${activateTarget.algorithm.replaceAll("_", " ")} ${activateTarget.versionTag} will replace the current production model. All new lead predictions will use this model.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={activating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={activating}
              onClick={(e) => {
                e.preventDefault();
                void activate();
              }}
            >
              {activating && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
