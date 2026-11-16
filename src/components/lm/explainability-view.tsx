"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Info,
  RotateCcw,
} from "lucide-react";
import { Tooltip as ChartTooltip, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fmtDate, qualColor, qualLabel } from "@/lib/api";
import type { LeadRowClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ContributionBars, EmptyState, FactorList, PageHeader } from "@/components/lm/shared";
import { useAppStore } from "@/lib/store";
import type { SessionData } from "@/lib/store";
import type {
  FitResult,
  IntentResult,
  PredictionResult,
  QualificationResult,
} from "@/lib/types";

// ── API payload interfaces ───────────────────────────────────────────────────

interface LeadDetailPayload {
  lead: { id: string; contactName: string; companyName: string | null };
  assessments: {
    fit: FitResult | null;
    intent: IntentResult | null;
    prediction: PredictionResult | null;
    qualification: QualificationResult | null;
  };
  history: {
    predictions: { at: string; probability: number | null; version: string }[];
    qualifications: { at: string; category: string; source: string; reasons: string[] }[];
    fitScores: { at: string; score: number | null; version: string }[];
  };
}

interface HistoryPoint {
  at: string;
  label: string;
  fit: number | null;
  prob: number | null;
}

const CHART_TOOLTIP = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } as const;
const BRAND = "#8b7cf6";
const INFO = "#7fb5fa";

function decisionBadgeClass(decision: string): string {
  return decision === "WILL_CONVERT"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
    : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300";
}

function decisionLabel(decision: string): string {
  return decision === "WILL_CONVERT" ? "Will convert" : "Will not convert";
}

// ── Main view ────────────────────────────────────────────────────────────────

export function ExplainabilityView({ session: _session }: { session: SessionData }) {
  const navigate = useAppStore((s) => s.navigate);

  const [leads, setLeads] = useState<LeadRowClient[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const res = await api<{ ok: boolean; items: LeadRowClient[] }>("/api/leads?pageSize=50&sort=recent");
      setLeads(res.items);
      setSelectedId(res.items[0]?.id ?? null);
    } catch (e) {
      setLeadsError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLeadsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await api<{ ok: boolean; detail: LeadDetailPayload }>(`/api/leads/${id}`);
      setDetail(res.detail);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load lead detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setDetail(null);
      setDetailError(null);
    }
  }, [selectedId, loadDetail]);

  const leadName = useMemo(() => {
    if (detail?.lead) {
      return `${detail.lead.contactName}${detail.lead.companyName ? ` · ${detail.lead.companyName}` : ""}`;
    }
    const row = leads.find((l) => l.id === selectedId);
    return row ? `${row.contactName} — ${row.companyName}` : "—";
  }, [detail, leads, selectedId]);

  const historyData = useMemo<HistoryPoint[]>(() => {
    if (!detail) return [];
    const map = new Map<string, HistoryPoint>();
    const touch = (at: string): HistoryPoint => {
      const existing = map.get(at);
      if (existing) return existing;
      const point: HistoryPoint = { at, label: fmtDate(at), fit: null, prob: null };
      map.set(at, point);
      return point;
    };
    for (const p of detail.history.predictions) {
      touch(p.at).prob = p.probability === null ? null : p.probability * 100;
    }
    for (const f of detail.history.fitScores) {
      touch(f.at).fit = f.score;
    }
    return [...map.values()]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(-30);
  }, [detail]);

  const assessments = detail?.assessments ?? null;
  const fit = assessments?.fit ?? null;
  const intent = assessments?.intent ?? null;
  const prediction = assessments?.prediction ?? null;
  const qualification = assessments?.qualification ?? null;

  const retryDetail = () => {
    if (selectedId) void loadDetail(selectedId);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Model Ops"
        title="Explainability Studio"
        description="Understand why each lead scored the way it did — factor breakdowns, model drivers and score history."
        actions={
          <>
            {leadsLoading ? (
              <Skeleton className="h-9 w-56" />
            ) : (
              <Select value={selectedId ?? ""} onValueChange={(v) => setSelectedId(v)} disabled={leads.length === 0}>
                <SelectTrigger className="w-56 sm:w-72" aria-label="Choose a lead to explain">
                  <SelectValue placeholder={leads.length === 0 ? "No leads available" : "Pick a lead"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.contactName} — {l.companyName ?? "Unknown company"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectedId && navigate("lead", { leadId: selectedId })}
              disabled={!selectedId}
            >
              <ExternalLink className="h-4 w-4" aria-hidden /> Open profile
            </Button>
          </>
        }
      />

      <p className="text-sm text-muted-foreground">
        Explaining <span className="font-medium text-foreground">{leadName}</span>
      </p>

      {leadsError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Could not load leads</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{leadsError}</span>
            <Button variant="outline" size="sm" onClick={() => void loadLeads()}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!leadsLoading && leads.length === 0 && !leadsError && (
        <Card className="p-0 gap-0">
          <CardContent className="p-4">
            <EmptyState title="No leads to explain" description="Add leads to the workspace first." />
          </CardContent>
        </Card>
      )}

      {detailError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Could not load lead detail</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{detailError}</span>
            <Button variant="outline" size="sm" onClick={retryDetail}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {detailLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-0 gap-0">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {detail && !detailLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Customer fit */}
          <Card className="p-0 gap-0">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Customer fit — {fit ? `${Math.round(fit.score)}/100` : "—"}</CardTitle>
              {fit && <CardDescription className="text-xs">ICP engine {fit.version}</CardDescription>}
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {fit ? (
                <>
                  {fit.factors.length > 0 ? (
                    <FactorList factors={fit.factors} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No factors recorded.</p>
                  )}
                  {fit.missing.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Missing information</p>
                      <div className="flex flex-wrap gap-1">
                        {fit.missing.map((m) => (
                          <span key={m} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">{fit.explanation}</p>
                </>
              ) : (
                <EmptyState title="No fit assessment" description="Run the scoring pipeline for this lead to compute ICP fit." icon={<Info className="h-5 w-5" aria-hidden />} />
              )}
            </CardContent>
          </Card>

          {/* Buying intent */}
          <Card className="p-0 gap-0">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Buying intent — {intent && intent.score !== null ? `${Math.round(intent.score)}/100` : "unknown"}</CardTitle>
              {intent && <CardDescription className="text-xs">Intent engine {intent.version}</CardDescription>}
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {intent ? (
                <>
                  {intent.factors.length > 0 ? (
                    <FactorList factors={intent.factors} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No intent signals recorded yet.</p>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">{intent.explanation}</p>
                </>
              ) : (
                <EmptyState title="No intent assessment" description="Intent needs tracked engagement events for this lead." icon={<Info className="h-5 w-5" aria-hidden />} />
              )}
            </CardContent>
          </Card>

          {/* Conversion prediction */}
          <Card className="p-0 gap-0">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Conversion prediction — {prediction ? `${(prediction.probability * 100).toFixed(1)}%` : "—"}</CardTitle>
              {prediction && (
                <CardDescription className="text-xs">
                  {prediction.algorithm.replaceAll("_", " ")} · model {prediction.modelVersion} · threshold {prediction.threshold.toFixed(2)}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {prediction ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-semibold tabular-nums">{(prediction.probability * 100).toFixed(1)}%</span>
                    <Badge className={cn("font-medium", decisionBadgeClass(prediction.decision))}>{decisionLabel(prediction.decision)}</Badge>
                  </div>
                  {prediction.contributions.length > 0 ? (
                    <ContributionBars
                      items={prediction.contributions.slice(0, 8).map((c) => ({ label: c.label, contribution: c.contribution }))}
                      formatter={(v) => `${(v * 100).toFixed(1)} pp`}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">No feature contributions recorded.</p>
                  )}
                  {prediction.warnings.length > 0 && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
                      <ul className="space-y-1">
                        {prediction.warnings.map((w, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">{prediction.reliability}</p>
                </>
              ) : (
                <EmptyState title="No prediction — no valid production model" description="Train and activate a model in Model Intelligence to generate conversion predictions." icon={<Info className="h-5 w-5" aria-hidden />} />
              )}
            </CardContent>
          </Card>

          {/* Qualification */}
          <Card className="p-0 gap-0">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Qualification — {qualification ? qualLabel(qualification.category) : "not assessed"}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              {qualification ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge className={cn("font-medium", qualColor(qualification.category))}>{qualLabel(qualification.category)}</Badge>
                    <span className="text-xs text-muted-foreground">rules {qualification.version}</span>
                  </div>
                  {qualification.reasons.length > 0 ? (
                    <ul className="space-y-1.5">
                      {qualification.reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" aria-hidden />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No reasons recorded.</p>
                  )}
                </>
              ) : (
                <EmptyState title="No qualification" description="Qualification rules have not produced a category for this lead yet." icon={<Info className="h-5 w-5" aria-hidden />} />
              )}
            </CardContent>
          </Card>

          {/* Score history */}
          <Card className="p-0 gap-0 md:col-span-2">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Score history</CardTitle>
              <CardDescription className="text-xs">Fit score (0–100) and conversion probability (%) over time.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {historyData.length === 0 ? (
                <EmptyState title="No score history yet" description="History builds up as assessments and predictions are re-run." />
              ) : (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" minTickGap={24} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={32} />
                      <ChartTooltip contentStyle={CHART_TOOLTIP} />
                      <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="fit" name="Fit score" stroke={BRAND} strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="prob" name="Conversion %" stroke={INFO} strokeWidth={2} dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
