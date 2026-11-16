"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, RotateCcw, Star } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, fmtRelative } from "@/lib/api";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, StatCard } from "@/components/lm/shared";
import type { SessionData } from "@/lib/store";

// ── API payload interfaces ───────────────────────────────────────────────────

type FeedbackKind = "GENERAL" | "RECOMMENDATION_RATING" | "SCORE_DISAGREEMENT";

interface FeedbackItem {
  id: string;
  kind: string;
  rating: number | null;
  comment: string | null;
  lead: string | null;
  createdAt: string;
}

interface EffectivenessRow {
  action: string;
  actionLabel: string;
  total: number;
  completed: number;
  dismissed: number;
  accepted: number;
  completionRate: number;
}

interface FeedbackResponse {
  ok: boolean;
  feedback: FeedbackItem[];
  effectiveness: EffectivenessRow[];
  overrides: number;
}

// ── Small helpers ────────────────────────────────────────────────────────────

function kindBadgeClass(kind: string): string {
  switch (kind) {
    case "RECOMMENDATION_RATING":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "SCORE_DISAGREEMENT":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "GENERAL":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "RECOMMENDATION_RATING":
      return "Recommendation rating";
    case "SCORE_DISAGREEMENT":
      return "Score disagreement";
    case "GENERAL":
      return "General";
    default:
      return kind.replaceAll("_", " ").toLowerCase();
  }
}

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) {
    return <span className="text-xs text-muted-foreground">No rating</span>;
  }
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn("h-3.5 w-3.5", i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
        />
      ))}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function FeedbackView({ session }: { session: SessionData }) {
  const canRecord = session.user.role !== "VIEWER";

  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("GENERAL");
  const [ratingSel, setRatingSel] = useState("none");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<FeedbackResponse>("/api/feedback");
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bestAction = useMemo(() => {
    const eligible = (data?.effectiveness ?? []).filter((e) => e.total > 0);
    if (eligible.length === 0) return null;
    return eligible.reduce((best, e) => (e.completionRate > best.completionRate ? e : best), eligible[0]);
  }, [data]);

  const openDialog = () => {
    setKind("GENERAL");
    setRatingSel("none");
    setComment("");
    setDialogOpen(true);
  };

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      await api<{ ok: boolean; id: string }>("/api/feedback", {
        method: "POST",
        body: {
          kind,
          rating: ratingSel === "none" ? undefined : Number(ratingSel),
          comment: comment.trim() === "" ? undefined : comment.trim(),
        },
      });
      toast.success("Feedback recorded", { description: "Thank you — it feeds the learning loop." });
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record feedback");
    } finally {
      setSubmitting(false);
    }
  }, [kind, ratingSel, comment, load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback & Learning"
        description="How the sales team's feedback and recommendation outcomes shape LeadMind over time."
        actions={
          canRecord ? (
            <Button size="sm" onClick={openDialog}>
              <Plus className="h-4 w-4" aria-hidden /> Record feedback
            </Button>
          ) : null
        }
      />

      {error && data === null ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Could not load feedback</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading && data === null ? (
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
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          {/* Stat cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total feedback items" value={data.feedback.length} hint="Latest 60 entries shown" />
            <StatCard title="Overrides recorded" value={data.overrides} hint="Manual qualification overrides" tone="brand" />
            <StatCard
              title="Best action"
              value={bestAction ? bestAction.actionLabel : "—"}
              hint={bestAction ? `${bestAction.completionRate}% completion` : "No completed recommendations yet"}
            />
            <StatCard title="Actions tracked" value={data.effectiveness.length} hint="Distinct recommendation types" />
          </div>

          {/* Recommendation effectiveness */}
          <Card className="p-0 gap-0">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Recommendation effectiveness</CardTitle>
              <CardDescription className="text-xs">
                How often reps accepted and completed each type of recommendation.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {data.effectiveness.length === 0 ? (
                <EmptyState
                  title="No recommendations tracked yet"
                  description="Effectiveness builds up as recommendations are generated and acted on."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Action</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Dismissed</TableHead>
                      <TableHead className="pr-4">Completion rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.effectiveness.map((e) => (
                      <TableRow key={e.action}>
                        <TableCell className="pl-4 font-medium">{e.actionLabel}</TableCell>
                        <TableCell className="text-right tabular-nums">{e.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{e.accepted}</TableCell>
                        <TableCell className="text-right tabular-nums">{e.completed}</TableCell>
                        <TableCell className="text-right tabular-nums">{e.dismissed}</TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-24">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    e.completionRate >= 50 ? "bg-emerald-500" : e.completionRate >= 20 ? "bg-amber-500" : "bg-zinc-400",
                                  )}
                                  style={{ width: `${Math.min(100, Math.max(0, e.completionRate))}%` }}
                                />
                              </div>
                            </div>
                            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{e.completionRate}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Sales feedback */}
          <Card className="p-0 gap-0">
            <CardHeader className="px-4 pt-4 pb-3">
              <CardTitle className="text-sm">Sales feedback</CardTitle>
              <CardDescription className="text-xs">Ratings, disagreements and comments from the team.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {data.feedback.length === 0 ? (
                <EmptyState
                  title="No feedback recorded yet"
                  description={canRecord ? "Use the Record feedback button to add the first entry." : "Feedback entries will appear here."}
                />
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto lm-scroll pr-1">
                  {data.feedback.map((f) => (
                    <div key={f.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={cn("font-medium", kindBadgeClass(f.kind))}>{kindLabel(f.kind)}</Badge>
                        <Stars rating={f.rating} />
                        <span className="ml-auto text-xs text-muted-foreground">{fmtRelative(f.createdAt)}</span>
                      </div>
                      {f.comment && <p className="mt-2 text-sm leading-relaxed">{f.comment}</p>}
                      {f.lead && <p className="mt-1.5 text-xs text-muted-foreground">Related lead: {f.lead}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Record feedback dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Record feedback</DialogTitle>
            <DialogDescription className="text-xs">
              Tell the learning loop what worked and what didn&apos;t — ratings and comments feed the model review cycle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Kind</p>
              <Select value={kind} onValueChange={(v) => setKind(v as FeedbackKind)}>
                <SelectTrigger className="w-full" aria-label="Feedback kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="RECOMMENDATION_RATING">Recommendation rating</SelectItem>
                  <SelectItem value="SCORE_DISAGREEMENT">Score disagreement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Rating (optional)</p>
              <Select value={ratingSel} onValueChange={setRatingSel}>
                <SelectTrigger className="w-full" aria-label="Rating out of 5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No rating</SelectItem>
                  <SelectItem value="1">1 — Poor</SelectItem>
                  <SelectItem value="2">2 — Fair</SelectItem>
                  <SelectItem value="3">3 — Good</SelectItem>
                  <SelectItem value="4">4 — Very good</SelectItem>
                  <SelectItem value="5">5 — Excellent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Comment (optional)</p>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. The fit score undervalues this lead — they match our ICP closely."
                rows={4}
                maxLength={1000}
                aria-label="Feedback comment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? "Saving…" : "Submit feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
