"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtRelative, priorityColor, qualColor, qualLabel, scoreColor } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import type { ScoreFactor } from "@/lib/types";

// ── Score ring ───────────────────────────────────────────────────────────────

export function ScoreRing({ score, size = 64, label }: { score: number | null; size?: number; label?: string }) {
  const stroke = size >= 60 ? 6 : 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = score === null ? "var(--muted-foreground)" : score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex flex-col items-center gap-1" role="meter" aria-valuenow={score ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "score"}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className={cn("absolute text-sm font-semibold", scoreColor(score))} style={{ marginTop: -(size / 2) - 9 }}>
        {score === null ? "—" : Math.round(score)}
      </span>
      {label && <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>}
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

export function StatCard({
  title,
  value,
  hint,
  tone = "default",
}: {
  title: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "brand" | "warning" | "danger";
}) {
  return (
    <Card className="p-0 gap-0 overflow-hidden">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <p
          className={cn(
            "mt-1.5 text-2xl font-semibold tabular-nums",
            tone === "brand" && "text-emerald-600 dark:text-emerald-400",
            tone === "warning" && "text-amber-600 dark:text-amber-400",
            tone === "danger" && "text-rose-600 dark:text-rose-400",
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function QualBadge({ category, source }: { category: string | null; source?: string }) {
  return (
    <Badge className={cn("font-medium", qualColor(category))} title={source ? `source: ${source}` : undefined}>
      {qualLabel(category)}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string | null }) {
  return <Badge className={cn("font-medium", priorityColor(priority))}>{priority ?? "—"}</Badge>;
}

// ── Factor list (explainability) ─────────────────────────────────────────────

export function FactorList({ factors, compact = false }: { factors: ScoreFactor[]; compact?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {factors.map((f, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span
            className={cn(
              "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
              f.impact === "POSITIVE" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
              f.impact === "NEGATIVE" && "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
              f.impact === "NEUTRAL" && "bg-muted text-muted-foreground",
            )}
          >
            {f.impact === "POSITIVE" ? "+" : f.impact === "NEGATIVE" ? "−" : "~"}
          </span>
          <div className="min-w-0">
            <span className="font-medium">{f.label}</span>
            {f.subscore !== undefined && (
              <span className={cn("ml-1.5 text-xs tabular-nums", scoreColor(f.subscore))}>{Math.round(f.subscore)}</span>
            )}
            {!compact && <p className="text-xs text-muted-foreground">{f.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Contribution bar (signed) ────────────────────────────────────────────────

export function ContributionBars({
  items,
  formatter,
}: {
  items: { label: string; contribution: number }[];
  formatter?: (v: number) => string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.contribution)), 0.0001);
  const fmt = formatter ?? ((v: number) => v.toFixed(3));
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-44 shrink-0 truncate text-muted-foreground" title={item.label}>
            {item.label}
          </span>
          <div className="relative h-3.5 flex-1 rounded bg-muted overflow-hidden">
            <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
            <div
              className={cn("absolute top-0 h-full rounded", item.contribution >= 0 ? "bg-emerald-500/80" : "bg-rose-500/80")}
              style={
                item.contribution >= 0
                  ? { left: "50%", width: `${(item.contribution / max) * 50}%` }
                  : { right: "50%", width: `${(-item.contribution / max) * 50}%` }
              }
            />
          </div>
          <span className={cn("w-16 shrink-0 text-right tabular-nums", item.contribution >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {fmt(item.contribution)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Empty / loading states ───────────────────────────────────────────────────

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-0 gap-0">
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Markdown renderer (chat) ─────────────────────────────────────────────────

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("lm-prose", className)}>
      <ReactMarkdown
        components={{
          a: (props) => <a {...props} className="text-emerald-700 dark:text-emerald-400 underline underline-offset-2" target="_blank" rel="noreferrer" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Event pill ───────────────────────────────────────────────────────────────

export function EventPill({ type, at }: { type: string; at?: string | null }) {
  const negative = type === "NEGATIVE_FEEDBACK" || type === "UNSUBSCRIBE";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs">
      <span className={cn("h-1.5 w-1.5 rounded-full", negative ? "bg-rose-500" : "bg-emerald-500")} />
      <span className="font-medium">{type.replaceAll("_", " ").toLowerCase()}</span>
      {at && <span className="text-muted-foreground">· {fmtRelative(at)}</span>}
    </span>
  );
}
