"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, ChevronRight, Clock, Inbox, RefreshCw, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SessionData } from "@/lib/store";
import { EmptyState, PageHeader, PriorityBadge } from "@/components/lm/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | "PENDING" | "ACCEPTED" | "COMPLETED" | "DISMISSED";
type PriorityFilter = "ALL" | "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type RecommendationDecision = "ACCEPTED" | "COMPLETED" | "DISMISSED";

interface Recommendation {
  id: string;
  leadId: string;
  leadName: string;
  companyName: string;
  action: string;
  actionLabel: string;
  priority: string;
  explanation: string;
  evidence: string[];
  signals: string[];
  suggestedTiming: string | null;
  status: string;
  createdAt: string;
}

interface RecommendationsResponse {
  ok: boolean;
  items: Recommendation[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "COMPLETED", label: "Completed" },
  { value: "DISMISSED", label: "Dismissed" },
];

const PRIORITIES: PriorityFilter[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  COMPLETED: "Completed",
  DISMISSED: "Dismissed",
};

// ── Main view ────────────────────────────────────────────────────────────────

export function ActionsView({ session }: { session: SessionData }) {
  const navigate = useAppStore((s) => s.navigate);

  const [statusTab, setStatusTab] = useState<StatusFilter>("PENDING");
  const [priority, setPriority] = useState<PriorityFilter>("ALL");
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusTab !== "ALL") params.set("status", statusTab);
    if (priority !== "ALL") params.set("priority", priority);
    try {
      const res = await api<RecommendationsResponse>(`/api/recommendations?${params.toString()}`);
      if (reqId !== reqIdRef.current) return;
      setItems(res.items ?? []);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load recommendations.");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [statusTab, priority]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUpdate(rec: Recommendation, decision: RecommendationDecision) {
    if (updatingId) return;
    setUpdatingId(rec.id);
    // Optimistic feedback, then persist and refetch.
    if (decision === "ACCEPTED") {
      toast.success(`Accepted — ${rec.actionLabel}`, { description: rec.companyName });
    } else if (decision === "COMPLETED") {
      toast.success(`Completed — ${rec.actionLabel}`, { description: rec.companyName });
    } else {
      toast.info(`Dismissed — ${rec.actionLabel}`, { description: rec.companyName });
    }
    setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: decision } : r)));
    try {
      await api<{ ok: boolean; id?: string; status?: string }>(`/api/recommendations/${rec.id}`, {
        method: "PATCH",
        body: { status: decision },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the action. Please try again.");
    } finally {
      setUpdatingId(null);
      void load();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Action Center" description="Evidence-based next-best actions awaiting a human decision" />

      <Tabs
        value={statusTab}
        onValueChange={(v) => setStatusTab(v as StatusFilter)}
        className="gap-4"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="max-w-full overflow-x-auto" aria-label="Filter recommendations by status">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2">
            <Label htmlFor="lm-action-priority" className="whitespace-nowrap text-sm text-muted-foreground">
              Priority
            </Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as PriorityFilter)}>
              <SelectTrigger id="lm-action-priority" className="w-40" aria-label="Filter by priority">
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All priorities</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>Failed to load recommendations</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{error}</span>
                <Button variant="outline" onClick={() => void load()}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={`skeleton-${i}`} className="gap-0 p-0">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-16" />
                      <Skeleton className="h-5 flex-1" />
                    </div>
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-14 w-full" />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-24" />
                      <Skeleton className="h-9 w-28" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : items.length === 0 ? (
            <Card className="gap-0 p-0">
              <CardContent className="p-4">
                <EmptyState
                  title="No recommendations here — run lead assessments to generate actions"
                  description="Switch tabs, clear the priority filter, or run an assessment from a lead profile to generate new actions."
                  icon={<Inbox className="size-8" aria-hidden="true" />}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((rec) => (
                <Card key={rec.id} className="gap-0 p-0">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <PriorityBadge priority={rec.priority} />
                        <span className="truncate font-medium">{rec.actionLabel}</span>
                      </div>
                    </div>
                    {rec.suggestedTiming && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                        {rec.suggestedTiming}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate("lead", { leadId: rec.leadId })}
                      className="mt-2.5 max-w-full text-left text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                      aria-label={`Open lead profile for ${rec.leadName}`}
                    >
                      {rec.leadName} — {rec.companyName}
                    </button>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{rec.explanation}</p>

                    {rec.evidence.length > 0 && (
                      <div className="mt-3 rounded-md border bg-muted/30 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
                        <ul className="mt-1.5 space-y-1">
                          {rec.evidence.map((item, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <ChevronRight
                                className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                      {rec.status === "PENDING" ? (
                        <>
                          <Button
                            variant="outline"
                            disabled={updatingId === rec.id}
                            onClick={() => void handleUpdate(rec, "ACCEPTED")}
                          >
                            <Check className="size-4" aria-hidden="true" />
                            Accept
                          </Button>
                          <Button
                            variant="outline"
                            disabled={updatingId === rec.id}
                            onClick={() => void handleUpdate(rec, "COMPLETED")}
                          >
                            <CheckCheck className="size-4" aria-hidden="true" />
                            Completed
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={updatingId === rec.id}
                            onClick={() => void handleUpdate(rec, "DISMISSED")}
                          >
                            <X className="size-4" aria-hidden="true" />
                            Dismiss
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge variant="outline" className="bg-muted text-muted-foreground">
                            {STATUS_LABELS[rec.status] ?? rec.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">Decision recorded</span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
