"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionData } from "@/lib/store";
import { useAppStore } from "@/lib/store";
import { api, fmtDateTime, fmtMoney, fmtRelative, scoreColor } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Gauge,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { ContributionBars, EmptyState, EventPill, FactorList, QualBadge, ScoreRing } from "@/components/lm/shared";
import { LiquidGlassButton } from "@/components/ui/liquid-glass-button";
import { cn } from "@/lib/utils";

interface FitPayload {
  score: number;
  factors: { label: string; detail: string; impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL"; subscore?: number; weightShare?: number }[];
  missing: string[];
  explanation: string;
  version: string;
}
interface IntentPayload {
  score: number | null;
  factors: { label: string; detail: string; impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL" }[];
  events: { type: string; count: number; effectiveWeight: number; lastAt: string }[];
  explanation: string;
  version: string;
  lastEventAt: string | null;
}
interface PredPayload {
  probability: number;
  decision: string;
  modelVersion: string;
  algorithm: string;
  threshold: number;
  contributions: { feature: string; label: string; value: number; contribution: number }[];
  warnings: string[];
  reliability: string;
}
interface QualPayload {
  category: string;
  reasons: string[];
  version: string;
}
interface LeadDetail {
  lead: Record<string, unknown> & {
    id: string;
    contactName: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    status: string;
    source: string | null;
    dealValue: number | null;
    createdAt: string;
    company: { name: string; industry: string | null; employeeCount: number | null; revenueBand: string | null; country: string | null; businessModel: string | null; website: string | null } | null;
  };
  timeline: { at: string; kind: string; label: string; detail: string | null }[];
  assessments: { fit: FitPayload | null; intent: IntentPayload | null; prediction: PredPayload | null; qualification: QualPayload | null };
  history: {
    predictions: { at: string; probability: number | null; version: string }[];
    qualifications: { at: string; category: string; source: string; reasons: string[] }[];
    fitScores: { at: string; score: number | null; version: string }[];
  };
  recommendations: { id: string; action: string; priority: string; explanation: string; evidence: string[]; signals: string[]; status: string; suggestedTiming: string | null; createdAt: string }[];
  outcomes: { id: string; outcome: string; dealValue: number | null; notes: string | null; occurredAt: string; source: string }[];
  feedbacks: { id: string; kind: string; rating: number | null; comment: string | null; createdAt: string }[];
  memories: { id: string; scope: string; value: string; approved: boolean; updatedAt: string }[];
}

const EVENT_TYPES = [
  "WEBSITE_VISIT", "PRICING_VISIT", "PRODUCT_VISIT", "DEMO_REQUEST", "EMAIL_OPEN", "EMAIL_CLICK",
  "SOCIAL_ENGAGEMENT", "FORM_SUBMIT", "CONTACTED", "MEETING", "NEGATIVE_FEEDBACK", "UNSUBSCRIBE", "NOTE",
];

const QUAL_CATEGORIES = [
  { value: "SALES_READY", label: "Sales Ready" },
  { value: "NURTURE_TRACK", label: "Nurture Track" },
  { value: "KEEP_WARM", label: "Keep Warm" },
  { value: "MANUAL_REVIEW", label: "Manual Review" },
];

function prettify(s: string): string {
  return s.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function LeadProfileView({ session }: { session: SessionData }) {
  const activeLeadId = useAppStore((s) => s.activeLeadId);
  const navigate = useAppStore((s) => s.navigate);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [lastTrace, setLastTrace] = useState<{ step: string; status: string; ms: number; cached?: boolean }[] | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const leadId = activeLeadId;

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ detail: LeadDetail }>(`/api/leads/${leadId}`);
      setDetail(res.detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAssessment = async (force = false) => {
    if (!leadId) return;
    setAssessing(true);
    try {
      const res = await api<{ result: { trace: { step: string; status: string; ms: number; cached?: boolean }[] }; detail: LeadDetail }>(
        `/api/leads/${leadId}/assess`,
        { method: "POST", body: { force } },
      );
      setDetail(res.detail);
      setLastTrace(res.result.trace);
      toast.success("Assessment complete — fit, intent, prediction, qualification and recommendations refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assessment failed");
    } finally {
      setAssessing(false);
    }
  };

  if (!leadId) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("leads")} className="pl-1">
          <ChevronLeft className="mr-1 h-4 w-4" /> All leads
        </Button>
        <EmptyState title="No lead selected" description="Open a lead from the Lead Universe to see its intelligence profile." />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("leads")} className="pl-1">
          <ChevronLeft className="mr-1 h-4 w-4" /> All leads
        </Button>
        <EmptyState title="Could not load lead" description={error ?? undefined} />
      </div>
    );
  }

  const { lead, assessments } = detail;
  const company = lead.company;
  const eventCount = typeof lead.eventCount === "number" ? lead.eventCount : detail.timeline.filter((t) => t.kind === "EVENT").length;
  const qual = detail.history.qualifications[0] ?? null;

  const updateStatus = async (status: string) => {
    setBusy("status");
    try {
      const res = await api<{ detail: LeadDetail }>(`/api/leads/${lead.id}`, { method: "PATCH", body: { status } });
      setDetail(res.detail);
      toast.success(`Status updated to ${prettify(status)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const submitOutcome = async (outcome: string, dealValue: string, notes: string) => {
    setBusy("outcome");
    try {
      const res = await api<{ detail: LeadDetail; note?: string }>(`/api/leads/${lead.id}/outcome`, {
        method: "POST",
        body: { outcome, dealValue: dealValue ? Number(dealValue) : undefined, notes: notes || undefined },
      });
      setDetail(res.detail);
      setOutcomeOpen(false);
      toast.success(res.note ?? `Outcome ${outcome} recorded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record outcome");
    } finally {
      setBusy(null);
    }
  };

  const submitOverride = async (category: string, reason: string) => {
    setBusy("override");
    try {
      const res = await api<{ detail: LeadDetail }>(`/api/leads/${lead.id}/qualification`, {
        method: "POST",
        body: { category, reason },
      });
      setDetail(res.detail);
      setOverrideOpen(false);
      toast.success(`Qualification overridden to ${prettify(category)} (recorded with reason)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Override failed");
    } finally {
      setBusy(null);
    }
  };

  const submitEvent = async (type: string) => {
    setBusy("event");
    try {
      await api(`/api/leads/${lead.id}/events`, { method: "POST", body: { type, source: "MANUAL" } });
      setEventOpen(false);
      toast.success(`${prettify(type)} event ingested — run an assessment to update intent`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to ingest event");
    } finally {
      setBusy(null);
    }
  };

  const submitFeedback = async (rating: number, comment: string) => {
    setBusy("feedback");
    try {
      const res = await api<{ detail: LeadDetail }>(`/api/leads/${lead.id}/feedback`, {
        method: "POST",
        body: { kind: "SCORE_DISAGREEMENT", rating, comment: comment || undefined },
      });
      setDetail(res.detail);
      toast.success("Feedback recorded — it feeds recommendation learning");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record feedback");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Button variant="ghost" onClick={() => navigate("leads")} className="-ml-2 w-fit pl-2 text-muted-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> All leads
        </Button>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{lead.contactName}</h1>
              <Badge variant="outline" className="font-medium">{prettify(lead.status)}</Badge>
              <QualBadge category={qual?.category ?? assessments.qualification?.category ?? null} source={qual?.source} />
              {lead.dealValue !== null && <Badge variant="outline" className="font-medium">{fmtMoney(lead.dealValue)}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {company?.name ?? "Unknown company"}
              {company?.industry ? ` · ${company.industry}` : ""}
              {company?.employeeCount ? ` · ${company.employeeCount.toLocaleString()} employees` : ""}
              {company?.country ? ` · ${company.country}` : ""}
              {lead.email ? ` · ${lead.email}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LiquidGlassButton variant="brand" onClick={() => runAssessment(false)} disabled={assessing} className="h-9">
              {assessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Run assessment
            </LiquidGlassButton>
            <Button variant="outline" onClick={() => runAssessment(true)} disabled={assessing} className="h-9">
              <Gauge className="mr-2 h-4 w-4" /> Force recompute
            </Button>
            <Button variant="outline" onClick={() => navigate("copilot", { leadContextId: lead.id })} className="h-9">
              <MessagesSquare className="mr-2 h-4 w-4" /> Ask Copilot
            </Button>
            {session.user.role !== "VIEWER" && (
              <>
                <Button variant="outline" onClick={() => setEditOpen(true)} className="h-9">
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </Button>
                <Button variant="outline" onClick={() => setEventOpen(true)} className="h-9">
                  <Plus className="mr-2 h-4 w-4" /> Event
                </Button>
                <Button variant="outline" onClick={() => setOverrideOpen(true)} className="h-9">
                  <ClipboardList className="mr-2 h-4 w-4" /> Override
                </Button>
                <Button variant="outline" onClick={() => setOutcomeOpen(true)} className="h-9">
                  <Trophy className="mr-2 h-4 w-4" /> Outcome
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {lastTrace && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Execution trace:</span>
          {lastTrace.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 ring-1 ring-border">
              <CheckCircle2 className={cn("h-3 w-3", s.status === "OK" ? "text-emerald-500" : "text-amber-500")} />
              {s.step.toLowerCase()}
              {s.cached ? " (cached)" : ` ${s.ms}ms`}
            </span>
          ))}
        </div>
      )}

      {/* Score summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-0 gap-0">
          <CardContent className="flex items-center gap-4 p-4">
            <ScoreRing score={assessments.fit?.score ?? null} size={72} />
            <div className="min-w-0">
              <p className="text-sm font-medium">Customer fit</p>
              <p className="text-xs text-muted-foreground">ICP {assessments.fit?.version ?? "—"}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{assessments.fit?.explanation ?? "Not assessed yet"}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="p-0 gap-0">
          <CardContent className="flex items-center gap-4 p-4">
            <ScoreRing score={assessments.intent?.score ?? null} size={72} />
            <div className="min-w-0">
              <p className="text-sm font-medium">Buying intent</p>
              <p className="text-xs text-muted-foreground">
                {assessments.intent?.score === null ? "No engagement data yet" : `config ${assessments.intent?.version ?? "—"}`}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {eventCount > 0 ? `${eventCount} events · last ${fmtRelative(detail.timeline.find((t) => t.kind === "EVENT")?.at ?? null)}` : "No events recorded"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="p-0 gap-0">
          <CardContent className="flex items-center gap-4 p-4">
            <ScoreRing score={assessments.prediction ? assessments.prediction.probability * 100 : null} size={72} />
            <div className="min-w-0">
              <p className="text-sm font-medium">Conversion</p>
              <p className="text-xs text-muted-foreground">{assessments.prediction ? assessments.prediction.algorithm.toLowerCase() : "no valid model"}</p>
              {assessments.prediction && (
                <p className="mt-1 text-xs text-muted-foreground">
                  threshold {(assessments.prediction.threshold * 100).toFixed(0)}% · {assessments.prediction.decision === "WILL_CONVERT" ? "above" : "below"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="p-0 gap-0">
          <CardContent className="p-4">
            <p className="text-sm font-medium">Qualification</p>
            <div className="mt-2"><QualBadge category={assessments.qualification?.category ?? null} /></div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {(assessments.qualification?.reasons ?? ["Run an assessment to classify this lead"]).slice(0, 3).map((r, i) => (
                <li key={i} className="line-clamp-2">· {r}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="analysis">
        <TabsList className="h-9 flex-wrap">
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          <TabsTrigger value="history">History & outcomes</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-0 gap-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Fit factors</CardTitle>
              </CardHeader>
              <CardContent>
                {assessments.fit ? <FactorList factors={assessments.fit.factors} /> : <EmptyState title="Not assessed" />}
              </CardContent>
            </Card>
            <Card className="p-0 gap-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Intent factors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assessments.intent ? (
                  <>
                    <FactorList factors={assessments.intent.factors} compact />
                    {assessments.intent.events.length > 0 && (
                      <>
                        <Separator />
                        <div className="flex flex-wrap gap-1.5">
                          {assessments.intent.events.slice(0, 6).map((e, i) => (
                            <EventPill key={i} type={`${e.type} ×${e.count}`} />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <EmptyState title="No engagement data" description="Missing data is never interpreted as negative interest." />
                )}
              </CardContent>
            </Card>
            <Card className="p-0 gap-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Prediction contributions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assessments.prediction ? (
                  <>
                    <ContributionBars
                      items={assessments.prediction.contributions.slice(0, 8).map((c) => ({ label: c.label, contribution: c.contribution }))}
                      formatter={(v) => `${(v * 100).toFixed(1)}pp`}
                    />
                    {assessments.prediction.warnings.length > 0 && (
                      <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {assessments.prediction.warnings.map((w, i) => (
                          <p key={i}>{w}</p>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{assessments.prediction.reliability}</p>
                  </>
                ) : (
                  <EmptyState title="No prediction" description="Predictions require a trained production model. Train one under Model Intelligence." />
                )}
              </CardContent>
            </Card>
            <Card className="p-0 gap-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recorded outcomes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.outcomes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No verified outcomes recorded yet.</p>
                ) : (
                  detail.outcomes.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span className={cn("font-medium", o.outcome === "WON" ? "text-emerald-600" : o.outcome === "LOST" ? "text-rose-600" : "text-muted-foreground")}>
                        {o.outcome}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {o.dealValue !== null ? fmtMoney(o.dealValue) : ""} · {fmtDateTime(o.occurredAt)}
                      </span>
                    </div>
                  ))
                )}
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Sales feedback on scoring</p>
                  {detail.feedbacks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No feedback yet.</p>
                  ) : (
                    detail.feedbacks.map((f) => (
                      <div key={f.id} className="flex items-start justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={cn("h-3 w-3", f.rating !== null && i < f.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                          ))}
                        </span>
                        <span className="flex-1 text-right text-muted-foreground">{f.comment ?? prettify(f.kind)}</span>
                      </div>
                    ))
                  )}
                  {session.user.role !== "VIEWER" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={async () => {
                        await submitFeedback(2, "I disagree with the current scoring for this lead.");
                      }}
                      disabled={busy === "feedback"}
                    >
                      Disagree with scoring
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <Card className="p-0 gap-0">
            <CardContent className="p-4">
              <ScrollArea className="h-[26rem] lm-scroll pr-3">
                <ol className="relative space-y-4 border-l pl-5">
                  {detail.timeline.length === 0 && <EmptyState title="No activity yet" />}
                  {detail.timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span
                        className={cn(
                          "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                          t.kind === "EVENT" && !t.label.includes("NEGATIVE") && !t.label.includes("UNSUB") ? "bg-emerald-500" : "",
                          (t.label.includes("NEGATIVE") || t.label.includes("UNSUB")) && "bg-rose-500",
                          t.kind.startsWith("ASSESSMENT") && "bg-sky-600",
                          t.kind === "RECOMMENDATION" && "bg-amber-500",
                          t.kind === "OUTCOME" && "bg-violet-500",
                        )}
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{prettify(t.label)}</p>
                        <span className="text-xs text-muted-foreground">{fmtDateTime(t.at)}</span>
                      </div>
                      {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                      <span className="mt-0.5 inline-block text-[10px] uppercase tracking-wide text-muted-foreground/70">{t.kind}</span>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations" className="mt-4 space-y-3">
          {detail.recommendations.length === 0 ? (
            <EmptyState title="No recommendations" description="Run an assessment to generate evidence-based next actions." />
          ) : (
            detail.recommendations.map((r) => (
              <Card key={r.id} className="p-0 gap-0">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-medium">{prettify(r.action)}</Badge>
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      r.priority === "CRITICAL" ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" :
                      r.priority === "HIGH" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-muted text-muted-foreground",
                    )}>
                      {r.priority}
                    </span>
                    {r.suggestedTiming && <span className="text-xs text-muted-foreground">· {r.suggestedTiming}</span>}
                    <Badge variant="outline" className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">{r.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm">{r.explanation}</p>
                  {r.evidence.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {r.evidence.map((e, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Activity className="mt-0.5 h-3 w-3 shrink-0" /> {e}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-0 gap-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Prediction history</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.history.predictions.length === 0 ? (
                <EmptyState title="No predictions yet" />
              ) : (
                <ul className="space-y-1.5">
                  {detail.history.predictions.slice(0, 8).map((p, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{fmtDateTime(p.at)}</span>
                      <span className={cn("tabular-nums", scoreColor(p.probability !== null ? p.probability * 100 : null))}>
                        {p.probability !== null ? `${Math.round(p.probability * 100)}%` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="p-0 gap-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Qualification history</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.history.qualifications.length === 0 ? (
                <EmptyState title="No qualification history" />
              ) : (
                <ul className="space-y-2">
                  {detail.history.qualifications.map((q, i) => (
                    <li key={i} className="rounded-md border px-3 py-2">
                      <div className="flex items-center justify-between">
                        <QualBadge category={q.category} source={q.source} />
                        <span className="text-xs text-muted-foreground">{fmtDateTime(q.at)}</span>
                      </div>
                      {q.reasons.slice(0, 2).map((r, j) => (
                        <p key={j} className="mt-1 text-xs text-muted-foreground">· {r}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="p-0 gap-0 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Assistant memory for this lead</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.memories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stored memories. The Copilot can store context facts after your confirmation.</p>
              ) : (
                detail.memories.map((m) => (
                  <div key={m.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{m.scope}</span>
                      {m.value}
                    </div>
                    <Badge variant={m.approved ? "outline" : "secondary"} className="shrink-0 text-[10px]">
                      {m.approved ? "approved" : "pending"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <EditLeadDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={lead}
        company={company}
        onSaved={load}
      />

      {/* Event dialog */}
      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ingest event</DialogTitle>
            <DialogDescription>Add a behavioural event for {lead.contactName}. Events drive the buying-intent score.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {EVENT_TYPES.map((t) => (
              <Button key={t} variant="outline" size="sm" disabled={busy === "event"} onClick={() => submitEvent(t)} className="justify-start text-xs">
                {prettify(t)}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Outcome dialog */}
      <Dialog open={outcomeOpen} onOpenChange={setOutcomeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record verified outcome</DialogTitle>
            <DialogDescription>Verified outcomes become real training labels for the next model build.</DialogDescription>
          </DialogHeader>
          <OutcomeForm onSubmit={(o, dv, notes) => submitOutcome(o, dv, notes)} busy={busy === "outcome"} />
        </DialogContent>
      </Dialog>

      {/* Override dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override qualification</DialogTitle>
            <DialogDescription>Manual overrides are recorded with your reason and audit-logged.</DialogDescription>
          </DialogHeader>
          <OverrideForm onSubmit={(c, r) => submitOverride(c, r)} busy={busy === "override"} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-forms ────────────────────────────────────────────────────────────────

function OutcomeForm({ onSubmit, busy }: { onSubmit: (outcome: string, dealValue: string, notes: string) => void; busy: boolean }) {
  const [outcome, setOutcome] = useState("WON");
  const [dealValue, setDealValue] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="outcome">Outcome</Label>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger id="outcome" aria-label="Outcome"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="WON">Won</SelectItem>
            <SelectItem value="LOST">Lost</SelectItem>
            <SelectItem value="OPEN">Still open</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dealValue">Deal value (USD, optional)</Label>
        <Input id="dealValue" type="number" min="0" value={dealValue} onChange={(e) => setDealValue(e.target.value)} placeholder="48000" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="outcomeNotes">Notes (optional)</Label>
        <Textarea id="outcomeNotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Closed after demo sequence…" />
      </div>
      <DialogFooter>
        <Button onClick={() => onSubmit(outcome, dealValue, notes)} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record outcome
        </Button>
      </DialogFooter>
    </div>
  );
}

function OverrideForm({ onSubmit, busy }: { onSubmit: (category: string, reason: string) => void; busy: boolean }) {
  const [category, setCategory] = useState("SALES_READY");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="qualCategory">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="qualCategory" aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QUAL_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="overrideReason">Reason (required)</Label>
        <Textarea id="overrideReason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Personal relationship with the buyer validates engagement despite low event count" />
      </div>
      <DialogFooter>
        <Button onClick={() => onSubmit(category, reason)} disabled={busy || reason.trim().length < 3}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save override
        </Button>
      </DialogFooter>
    </div>
  );
}

function EditLeadDialog({
  open,
  onOpenChange,
  lead,
  company,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: { contactName: string; email: string | null; phone: string | null; title: string | null; status: string; dealValue: number | null };
  company: { industry: string | null; employeeCount: number | null; revenueBand: string | null; country: string | null; businessModel: string | null } | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    contactName: lead.contactName,
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    title: lead.title ?? "",
    status: lead.status,
    dealValue: lead.dealValue?.toString() ?? "",
    industry: company?.industry ?? "",
    employeeCount: company?.employeeCount?.toString() ?? "",
    revenueBand: company?.revenueBand ?? "",
    country: company?.country ?? "",
    businessModel: company?.businessModel ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/leads/${useAppStore.getState().activeLeadId}`, {
        method: "PATCH",
        body: {
          contactName: form.contactName,
          email: form.email || undefined,
          phone: form.phone || undefined,
          title: form.title || undefined,
          status: form.status,
          dealValue: form.dealValue === "" ? null : Number(form.dealValue),
          industry: form.industry || undefined,
          employeeCount: form.employeeCount === "" ? null : Number(form.employeeCount),
          revenueBand: form.revenueBand || undefined,
          country: form.country || undefined,
          businessModel: form.businessModel || undefined,
        },
      });
      toast.success("Lead updated — scores will refresh automatically");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
          <DialogDescription>Company attribute changes automatically invalidate the fit-score cache.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="f-contact">Contact name</Label>
            <Input id="f-contact" value={form.contactName} onChange={(e) => set("contactName")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-email">Email</Label>
            <Input id="f-email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-title">Title</Label>
            <Input id="f-title" value={form.title} onChange={(e) => set("title")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-phone">Phone</Label>
            <Input id="f-phone" value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-status">Status</Label>
            <Select value={form.status} onValueChange={set("status")}>
              <SelectTrigger id="f-status" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["NEW", "ACTIVE", "NURTURING", "QUALIFIED", "WON", "LOST", "UNQUALIFIED"].map((s) => (
                  <SelectItem key={s} value={s}>{prettify(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-deal">Deal value (USD)</Label>
            <Input id="f-deal" type="number" min="0" value={form.dealValue} onChange={(e) => set("dealValue")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-industry">Industry</Label>
            <Input id="f-industry" value={form.industry} onChange={(e) => set("industry")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-emp">Employees</Label>
            <Input id="f-emp" type="number" min="0" value={form.employeeCount} onChange={(e) => set("employeeCount")(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-rev">Revenue band</Label>
            <Select value={form.revenueBand || "UNKNOWN"} onValueChange={(v) => set("revenueBand")(v === "UNKNOWN" ? "" : v)}>
              <SelectTrigger id="f-rev" aria-label="Revenue band"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
                {["<1M", "1M-10M", "10M-50M", "50M-100M", "100M+"].map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-country">Country</Label>
            <Input id="f-country" value={form.country} onChange={(e) => set("country")(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="f-bm">Business model</Label>
            <Select value={form.businessModel || "UNKNOWN"} onValueChange={(v) => set("businessModel")(v === "UNKNOWN" ? "" : v)}>
              <SelectTrigger id="f-bm" aria-label="Business model"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
                {["B2B_SAAS", "ENTERPRISE", "MARKETPLACE", "B2C", "AGENCY", "OTHER"].map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || form.contactName.trim().length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
