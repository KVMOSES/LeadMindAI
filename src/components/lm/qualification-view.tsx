"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronRight, Cpu, History, ShieldCheck, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDateTime, qualLabel, scoreColor } from "@/lib/api";
import type { LeadRowClient } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SessionData } from "@/lib/store";
import { cn } from "@/lib/utils";
import { EmptyState, FactorList, PageHeader, QualBadge } from "@/components/lm/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ScoreFactor } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface LeadsResponse {
  ok: boolean;
  items: LeadRowClient[];
  total: number;
}

interface DetailPayload {
  lead: {
    id: string;
    contactName: string;
    companyName: string | null;
    company?: { industry: string | null; employeeCount: number | null; country: string | null; revenueBand: string | null } | null;
  };
  assessments: {
    fit: { score: number; factors: ScoreFactor[]; missing: string[]; version: string } | null;
    intent: { score: number | null; factors: ScoreFactor[]; version: string } | null;
    prediction: { probability: number; decision: string; algorithm: string; modelVersion: string } | null;
    qualification: { category: string; reasons: string[]; version: string } | null;
  };
  history: {
    qualifications: { at: string; category: string; source: string; reasons: string[] }[];
  };
}

const QUALIFICATIONS = ["SALES_READY", "NURTURE_TRACK", "KEEP_WARM", "MANUAL_REVIEW"] as const;

function sourceBadgeClass(source: string | undefined): string {
  switch (source) {
    case "MANUAL":
      return "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300";
    case "ENGINE":
    case "AUTO":
      return "border-[var(--lm-info)]/40 bg-[var(--lm-info-soft)] text-[var(--lm-info)]";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function sourceLabel(source: string | undefined): string {
  if (source === "MANUAL") return "Manual override";
  if (source === "ENGINE" || source === "AUTO") return "AI engine";
  return source ?? "Unknown";
}

// ── Override form ────────────────────────────────────────────────────────────

function OverrideForm({
  leadId,
  current,
  onOverridden,
}: {
  leadId: string;
  current: string | null;
  onOverridden: () => void;
}) {
  const [category, setCategory] = useState<string>(current && current !== "NOT_QUALIFIED" ? current : "SALES_READY");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      toast.error("Provide a short reason for the override (min. 3 characters).");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/leads/${leadId}/qualification`, {
        method: "POST",
        body: { category, reason: reason.trim() },
      });
      toast.success(`Qualification overridden — ${qualLabel(category)}`, { description: "The change is recorded in the audit log." });
      setReason("");
      onOverridden();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Override failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <UserCheck className="size-4 text-[var(--lm-brand)]" aria-hidden="true" />
          <p className="lm-card-title">Manual override</p>
          <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
            logged &amp; audited
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Overrides the AI qualification for this lead. Your reason is stored with the decision and shown in the qualification history.
        </p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lm-override-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="lm-override-category" aria-label="Override category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALIFICATIONS.map((q) => (
                  <SelectItem key={q} value={q}>
                    {qualLabel(q)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lm-override-reason">Reason</Label>
            <Textarea
              id="lm-override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Signed an enterprise contract in Q3 — treat as sales ready despite low engagement."
              aria-label="Override reason"
            />
          </div>
          <Button type="submit" disabled={saving || reason.trim().length < 3}>
            {saving ? "Saving override…" : "Apply override"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function QualificationView({ session }: { session: SessionData }) {
  const navigate = useAppStore((s) => s.navigate);
  const canOverride = session.user.role !== "VIEWER";

  const [filter, setFilter] = useState<string>("ALL");
  const [items, setItems] = useState<LeadRowClient[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const listReqRef = useRef(0);

  const loadList = useCallback(async () => {
    const reqId = ++listReqRef.current;
    setLoadingList(true);
    setListError(null);
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("qualification", filter);
    params.set("sort", "recent");
    params.set("order", "desc");
    params.set("page", "1");
    params.set("pageSize", "50");
    try {
      const res = await api<LeadsResponse>(`/api/leads?${params.toString()}`);
      if (reqId !== listReqRef.current) return;
      setItems(res.items ?? []);
      setSelectedId((prev) => (prev && (res.items ?? []).some((l) => l.id === prev) ? prev : (res.items ?? [])[0]?.id ?? null));
    } catch (err) {
      if (reqId !== listReqRef.current) return;
      setListError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      if (reqId === listReqRef.current) setLoadingList(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await api<{ detail: DetailPayload }>(`/api/leads/${id}`);
      setDetail(res.detail);
    } catch (err) {
      setDetail(null);
      setDetailError(err instanceof Error ? err.message : "Failed to load qualification detail");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const lead = detail?.lead;
  const activeQualification = detail?.history.qualifications?.[0] ?? null;
  const fit = detail?.assessments.fit ?? null;
  const intent = detail?.assessments.intent ?? null;
  const prediction = detail?.assessments.prediction ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Intelligence"
        title="Qualification"
        description="Structured qualification workspace — criteria, evidence, AI decisions, manual overrides and the full decision history."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* Lead list */}
        <Card className="lm-panel p-0 gap-0 overflow-hidden">
          <div className="border-b p-3">
            <p className="lm-card-title">Workspace leads</p>
            <p className="text-xs text-muted-foreground">Select a lead to inspect its qualification</p>
          </div>
          <div className="flex gap-1 overflow-x-auto border-b px-3 py-2" role="tablist" aria-label="Filter by qualification">
            {(["ALL", ...QUALIFICATIONS] as const).map((q) => (
              <button
                key={q}
                role="tab"
                aria-selected={filter === q}
                onClick={() => setFilter(q)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === q
                    ? "bg-[var(--lm-brand-soft)] text-[var(--lm-brand)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {q === "ALL" ? "All" : qualLabel(q)}
              </button>
            ))}
          </div>
          <div className="lm-scroll max-h-[560px] overflow-y-auto" aria-busy={loadingList}>
            {listError ? (
              <Alert variant="destructive" className="m-3">
                <AlertTitle>Load failed</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span className="text-xs">{listError}</span>
                  <Button variant="outline" size="sm" onClick={() => void loadList()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : loadingList ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState title="No leads in this segment" description="Run assessments or adjust the filter." />
            ) : (
              <ul className="divide-y">
                {items.map((l) => {
                  const active = l.id === selectedId;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(l.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                          active ? "bg-[var(--lm-brand-soft)]" : "hover:bg-muted/60",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{l.companyName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            Fit {l.fit === null ? "—" : Math.round(l.fit)} · Intent {l.intent === null ? "—" : Math.round(l.intent)}
                            {l.qualification?.source ? ` · ${l.qualification.source === "MANUAL" ? "manual" : "AI"}` : ""}
                          </p>
                        </div>
                        <QualBadge category={l.qualification?.category ?? null} />
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-opacity", active ? "opacity-100" : "opacity-40")} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        {/* Detail */}
        <div className="space-y-4">
          {loadingDetail ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full rounded-xl" />
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </div>
            </div>
          ) : detailError ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load qualification detail</AlertTitle>
              <AlertDescription>
                <span>{detailError}</span>
                <Button variant="outline" size="sm" className="ml-3" onClick={() => selectedId && void loadDetail(selectedId)}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : !detail || !lead ? (
            <Card className="lm-panel p-0 gap-0">
              <CardContent className="p-4">
                <EmptyState title="Select a lead" description="Choose a lead from the list to inspect its qualification evidence." />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Decision header */}
              <Card className="lm-panel-elevated p-0 gap-0">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => navigate("lead", { leadId: lead.id })}
                        className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded"
                        aria-label={`Open full profile for ${lead.companyName ?? lead.contactName}`}
                      >
                        <h2 className="truncate text-base font-semibold hover:underline">{lead.companyName ?? "Unknown company"}</h2>
                        <p className="text-xs text-muted-foreground">
                          {lead.contactName}
                          {lead.company?.industry ? ` · ${lead.company.industry}` : ""}
                        </p>
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <QualBadge category={detail.assessments.qualification?.category ?? activeQualification?.category ?? null} />
                      <Badge variant="outline" className={cn("gap-1 font-medium", sourceBadgeClass(activeQualification?.source))}>
                        {activeQualification?.source === "MANUAL" ? (
                          <UserCheck className="size-3" aria-hidden="true" />
                        ) : (
                          <Cpu className="size-3" aria-hidden="true" />
                        )}
                        {sourceLabel(activeQualification?.source)}
                      </Badge>
                    </div>
                  </div>

                  {/* Qualification reasons */}
                  <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Qualification reasons</p>
                    {detail.assessments.qualification?.reasons?.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {detail.assessments.qualification.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--lm-info)]" aria-hidden="true" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    ) : activeQualification?.reasons?.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {activeQualification.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--lm-info)]" aria-hidden="true" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5 text-sm text-muted-foreground">No qualification reasons recorded yet — run the scoring pipeline for this lead.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Criteria + evidence */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="lm-panel p-0 gap-0">
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="lm-card-title">Customer fit criteria</p>
                      <span className={cn("text-sm font-semibold tabular-nums", scoreColor(fit?.score ?? null))}>
                        {fit ? `${Math.round(fit.score)}/100` : "—"}
                      </span>
                    </div>
                    {fit ? (
                      <div className="mt-2.5">
                        <FactorList factors={fit.factors} />
                        {fit.missing.length > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">Missing: {fit.missing.join(", ")}</p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No fit assessment — run the scoring pipeline.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="lm-panel p-0 gap-0">
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="lm-card-title">Buying intent signals</p>
                      <span className={cn("text-sm font-semibold tabular-nums", scoreColor(intent?.score ?? null))}>
                        {intent && intent.score !== null ? `${Math.round(intent.score)}/100` : "unknown"}
                      </span>
                    </div>
                    {intent ? (
                      <div className="mt-2.5">
                        <FactorList factors={intent.factors} />
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No tracked engagement events for this lead yet.</p>
                    )}
                    {prediction && (
                      <div className="mt-3 rounded-lg border bg-muted/30 p-2.5">
                        <p className="text-xs text-muted-foreground">
                          Conversion prediction: <span className="font-semibold text-foreground">{(prediction.probability * 100).toFixed(1)}%</span>
                          {" · "}
                          {prediction.algorithm.replaceAll("_", " ")} · {prediction.modelVersion}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* History */}
              <Card className="lm-panel p-0 gap-0">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <History className="size-4 text-muted-foreground" aria-hidden="true" />
                    <p className="lm-card-title">Qualification history</p>
                    <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
                      {detail.history.qualifications.length} entr{detail.history.qualifications.length === 1 ? "y" : "ies"}
                    </Badge>
                  </div>
                  {detail.history.qualifications.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No qualification decisions recorded yet.</p>
                  ) : (
                    <ol className="mt-3 space-y-3 border-l pl-4">
                      {detail.history.qualifications.map((q, i) => (
                        <li key={i} className="relative">
                          <span
                            className={cn(
                              "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--card)]",
                              q.source === "MANUAL" ? "bg-[var(--lm-brand)]" : "bg-[var(--lm-info)]",
                            )}
                            aria-hidden="true"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <QualBadge category={q.category} />
                            <Badge variant="outline" className={cn("text-[10px]", sourceBadgeClass(q.source))}>
                              {sourceLabel(q.source)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{fmtDateTime(q.at)}</span>
                          </div>
                          {q.reasons.length > 0 && (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{q.reasons.join(" · ")}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>

              {/* Override */}
              {canOverride ? (
                <OverrideForm
                  key={lead.id}
                  leadId={lead.id}
                  current={detail.assessments.qualification?.category ?? activeQualification?.category ?? null}
                  onOverridden={() => {
                    void loadList();
                    if (selectedId) void loadDetail(selectedId);
                  }}
                />
              ) : (
                <Card className="border-dashed">
                  <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                    <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                    Manual overrides require MEMBER or ADMIN permissions — your role ({session.user.role}) is read-only for qualification decisions.
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
