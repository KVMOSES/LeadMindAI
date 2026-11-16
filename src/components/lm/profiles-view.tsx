"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Gauge, HeartPulse, Sparkles, Thermometer, Users, Zap } from "lucide-react";
import { api, fmtMoney, fmtRelative, qualLabel, scoreColor } from "@/lib/api";
import type { LeadRowClient } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SessionData } from "@/lib/store";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, QualBadge } from "@/components/lm/shared";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TriangleAlert } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface LeadsResponse {
  ok: boolean;
  items: LeadRowClient[];
  total: number;
  page: number;
  pageSize: number;
  facets: { industries: string[] };
}

const QUALIFICATIONS = ["SALES_READY", "NURTURE_TRACK", "KEEP_WARM", "MANUAL_REVIEW"] as const;
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 350;

function prettifyAction(action: string | null): string {
  if (!action) return "—";
  const s = action.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ScoreBar({ label, value, percent = false }: { label: string; value: number | null; percent?: boolean }) {
  const raw = value === null ? null : percent ? Math.round(value * 100) : Math.round(value);
  const clamped = raw === null ? 0 : Math.min(100, Math.max(0, raw));
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className={cn("text-xs font-semibold tabular-nums", scoreColor(value))}>
          {raw === null ? "—" : percent ? `${raw}%` : raw}
        </span>
      </div>
      <Progress value={clamped} aria-label={`${label} ${raw ?? "not assessed"}`} className="mt-1 h-1" />
    </div>
  );
}

function ProfileCard({ lead }: { lead: LeadRowClient }) {
  const navigate = useAppStore((s) => s.navigate);
  return (
    <button
      type="button"
      onClick={() => navigate("lead", { leadId: lead.id })}
      className="group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl"
      aria-label={`Open intelligence profile for ${lead.companyName}`}
    >
      <Card className="lm-panel p-0 gap-0 transition-colors duration-200 group-hover:border-[var(--lm-brand)]/35 h-full">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{lead.companyName}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {lead.contactName}
                {lead.title ? ` · ${lead.title}` : ""}
              </p>
            </div>
            <QualBadge category={lead.qualification?.category ?? null} source={lead.qualification?.source} />
          </div>

          <div className="flex gap-3">
            <ScoreBar label="Fit" value={lead.fit} />
            <ScoreBar label="Intent" value={lead.intent} />
            <ScoreBar label="Conv" value={lead.probability} percent />
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="size-3 shrink-0 text-[var(--lm-brand)]" aria-hidden="true" />
              <span className="truncate">{prettifyAction(lead.topAction)}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              {fmtRelative(lead.lastEventAt)}
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function ProfilesView({ session: _session }: { session: SessionData }) {
  const navigate = useAppStore((s) => s.navigate);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [qualification, setQualification] = useState("ALL");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<LeadRowClient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, qualification]);

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("query", searchQuery.trim());
    if (qualification !== "ALL") params.set("qualification", qualification);
    params.set("sort", "recent");
    params.set("order", "desc");
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    try {
      const res = await api<LeadsResponse>(`/api/leads?${params.toString()}`);
      if (reqId !== reqIdRef.current) return;
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load profiles.");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [searchQuery, qualification, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Highlight leads derived from real data (only among loaded page, clearly scoped)
  const highlights = useMemo(() => {
    const pool = items;
    const maxBy = (key: "probability" | "fit" | "intent"): LeadRowClient | null => {
      let best: LeadRowClient | null = null;
      for (const l of pool) {
        if (l[key] === null || l[key] === undefined) continue;
        if (!best || (l[key] as number) > (best[key] as number)) best = l;
      }
      return best;
    };
    return {
      probability: maxBy("probability"),
      fit: maxBy("fit"),
      intent: maxBy("intent"),
    };
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasHighlights = highlights.probability || highlights.fit || highlights.intent;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Intelligence"
        title="Intelligence Profiles"
        description="Dossier-style view of every lead — fit, intent, conversion probability and the recommended next step in one glance."
      />

      {/* Intelligence highlights — only rendered from real page data */}
      {loading && items.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : hasHighlights ? (
        <section aria-label="Intelligence highlights" className="grid gap-4 sm:grid-cols-3">
          {highlights.probability && (
            <SpotlightCard
              className="p-4"
              spotlightColor="var(--lm-brand-soft)"
              aria-label="Highest conversion probability lead"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--lm-brand-soft)]">
                  <Gauge className="size-3.5 text-[var(--lm-brand)]" aria-hidden="true" />
                </span>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Highest conversion probability</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("lead", { leadId: highlights.probability!.id })}
                className="mt-2 block w-full text-left"
                aria-label={`Open ${highlights.probability.companyName} profile`}
              >
                <p className="truncate text-sm font-semibold">{highlights.probability.companyName}</p>
                <p className="lm-metric mt-2 text-[26px] text-[var(--lm-brand)]">
                  {Math.round(highlights.probability.probability! * 100)}%
                </p>
              </button>
            </SpotlightCard>
          )}
          {highlights.fit && (
            <SpotlightCard className="p-4" spotlightColor="var(--lm-info-soft)" aria-label="Strongest ICP fit lead">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--lm-info-soft)]">
                  <HeartPulse className="size-3.5 text-[var(--lm-info)]" aria-hidden="true" />
                </span>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Strongest ICP fit</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("lead", { leadId: highlights.fit!.id })}
                className="mt-2 block w-full text-left"
                aria-label={`Open ${highlights.fit.companyName} profile`}
              >
                <p className="truncate text-sm font-semibold">{highlights.fit.companyName}</p>
                <p className="lm-metric mt-2 text-[26px] text-[var(--lm-info)]">
                  {Math.round(highlights.fit.fit!)}/100
                </p>
              </button>
            </SpotlightCard>
          )}
          {highlights.intent && (
            <SpotlightCard className="p-4" spotlightColor="rgba(246,168,60,0.14)" aria-label="Hottest buying intent lead">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/10">
                  <Thermometer className="size-3.5 text-amber-500" aria-hidden="true" />
                </span>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Hottest buying intent</p>
              </div>
              <button
                type="button"
                onClick={() => navigate("lead", { leadId: highlights.intent!.id })}
                className="mt-2 block w-full text-left"
                aria-label={`Open ${highlights.intent.companyName} profile`}
              >
                <p className="truncate text-sm font-semibold">{highlights.intent.companyName}</p>
                <p className="lm-metric mt-2 text-[26px] text-amber-500">
                  {Math.round(highlights.intent.intent!)}/100
                </p>
              </button>
            </SpotlightCard>
          )}
        </section>
      ) : null}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Profile filters">
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search profiles..."
          className="w-full sm:w-64"
          aria-label="Search profiles"
        />
        <Select value={qualification} onValueChange={setQualification}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by qualification">
            <SelectValue placeholder="All qualifications" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All qualifications</SelectItem>
            {QUALIFICATIONS.map((q) => (
              <SelectItem key={q} value={q}>
                {qualLabel(q)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{total} profiles</span>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Failed to load profiles</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading && items.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-0 gap-0">
          <CardContent className="p-4">
            <EmptyState
              title="No profiles match your filters"
              description="Try adjusting the search or clearing the qualification filter."
              icon={<Users className="size-8" aria-hidden="true" />}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className={cn("grid gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", loading && "opacity-60")}>
            {items.map((lead) => (
              <ProfileCard key={lead.id} lead={lead} />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                <ChevronLeft className="size-4" aria-hidden="true" />
                Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3 text-[var(--lm-brand)]" aria-hidden="true" />
        Highlights are computed from the currently loaded profiles — sort or filter to scan other segments.
      </p>
    </div>
  );
}
