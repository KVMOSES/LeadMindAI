"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  BrainCircuit,
  Check,
  ChevronDown,
  Copy,
  CornerDownLeft,
  HelpCircle,
  Layers,
  ListChecks,
  Loader2,
  RefreshCcw,
  Search,
  Send,
  ShieldQuestion,
  Terminal,
  TrendingUp,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LiquidGlassButton } from "@/components/ui/liquid-glass-button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/lm/shared";
import { LogoMark } from "@/components/lm/logo";

/**
 * AnimatedAiChat — presentation layer for the LeadMind Copilot.
 *
 * This component renders the animated chat surface (message stream, typing
 * indicator, tool activity, confirmation gate, composer with a `/` command
 * palette). It contains **no AI logic of its own**: streaming, persistence,
 * permissions and tool execution are owned by the existing backend and wired
 * in through the callbacks below by `copilot-view.tsx`.
 *
 * Notes:
 * - Sizes to its container (never `min-h-screen` / `w-screen`) so it lives
 *   inside the application shell.
 * - Framer Motion is used for entrance/exit transitions only; all animations
 *   are disabled under `prefers-reduced-motion`.
 * - No attachment controls: the current backend has no file-upload endpoint,
 *   so none are rendered (no fake uploads).
 */

// ── Shared types (consumed by copilot-view) ──────────────────────────────────

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  ms: number;
}

export interface ChatMsg {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  toolTraces: ToolTrace[];
  createdAt: string;
  streaming?: boolean;
}

export interface PendingCard {
  pendingActionId: string;
  summary: string;
}

export interface CopilotCommand {
  command: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Text placed in the composer when selected. */
  template: string;
  /** When set, the message is sent immediately instead of filling the composer. */
  send?: string;
}

/**
 * Commands map to capabilities that actually exist in the Copilot tool
 * protocol (search_leads, qualification, assessments, dashboard metrics,
 * recommendations, engagement trends, knowledge search, help).
 */
export const COPILOT_COMMANDS: CopilotCommand[] = [
  { command: "/leads", label: "Search leads", hint: "Find prospects matching a query or filters", icon: Search, template: "/leads " },
  { command: "/qualify", label: "Qualify a prospect", hint: "Assess whether a lead is sales ready", icon: ListChecks, template: "/qualify " },
  { command: "/analyze", label: "Analyse a lead", hint: "Scores, predictions and why they look that way", icon: BrainCircuit, template: "/analyze " },
  { command: "/pipeline", label: "Summarise pipeline", hint: "Counts, conversion estimates and distribution", icon: Layers, template: "/pipeline " },
  { command: "/next-action", label: "Next best action", hint: "Highest-priority recommended plays", icon: Zap, template: "/next-action " },
  { command: "/insights", label: "Generate sales insights", hint: "Trends across engagement and industries", icon: TrendingUp, template: "/insights " },
  { command: "/help", label: "Show Copilot capabilities", hint: "What the assistant can and cannot do", icon: HelpCircle, template: "", send: "What can you do? List your capabilities and the tools you use.", },
];

/**
 * Slash commands are expanded into natural-language prompts before they reach
 * the Copilot, so the assistant reliably triggers the matching capability
 * regardless of how it interprets literal "/command" text.
 */
const COMMAND_EXPANSIONS: Record<string, string> = {
  "/leads": "Search my leads",
  "/qualify": "Qualify a prospect for me",
  "/analyze": "Analyse a lead for me",
  "/pipeline": "Summarise my current pipeline — counts, conversion estimates and distribution",
  "/next-action": "What is the next best action I should take right now?",
  "/insights": "Generate sales insights from my workspace data",
  "/help": "What can you do? List your capabilities and the tools you use.",
};

export function expandSlashCommand(text: string): string {
  const match = text.match(/^\/([a-zA-Z]+)\s*([\s\S]*)$/);
  if (!match) return text;
  const base = COMMAND_EXPANSIONS[`/${match[1].toLowerCase()}`];
  if (!base) return text;
  const rest = match[2].trim();
  return rest ? `${base}. Details: ${rest}` : base;
}

// ── Animation helpers ────────────────────────────────────────────────────────

const MESSAGE_VARIANTS = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16 } },
};

function TypingDots({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden="true">
      {[0, 1, 2].map((i) =>
        reduced ? (
          <span key={i} className="h-1.5 w-1.5 rounded-full bg-[var(--lm-brand)]/70" />
        ) : (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-[var(--lm-brand)]/70"
            animate={{ y: [0, -3, 0], opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ),
      )}
    </span>
  );
}

// ── Tool activity panel ──────────────────────────────────────────────────────

function ToolTracePanel({ traces }: { traces: ToolTrace[] }) {
  const [open, setOpen] = React.useState(false);
  const allOk = traces.every((t) => t.ok);
  return (
    <div className="w-full overflow-hidden rounded-xl border border-border/70 bg-muted/40 backdrop-blur-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/25">
          <Wrench className="h-3.5 w-3.5 text-[var(--lm-brand)]" aria-hidden="true" />
        </span>
        <span className="font-medium">{traces.length} tool execution{traces.length > 1 ? "s" : ""}</span>
        <span className="truncate text-muted-foreground">{traces.map((t) => t.name).join(", ")}</span>
        <span
          className={cn(
            "ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
            allOk ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500",
          )}
          aria-hidden="true"
        >
          {allOk ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 border-t border-border/70 px-3 py-2.5">
              {traces.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span
                    className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", t.ok ? "bg-emerald-500" : "bg-rose-500")}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] font-medium">
                      {t.name} <span className="font-sans text-muted-foreground">({t.ms}ms)</span>
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t.summary}</p>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[10px] text-muted-foreground/80">
                Every answer above is grounded in these validated tool results — no fabricated records.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Command palette ──────────────────────────────────────────────────────────

interface CommandPaletteProps {
  visible: boolean;
  activeIndex: number;
  items: CopilotCommand[];
  onSelect: (cmd: CopilotCommand) => void;
}

function CommandPalette({ visible, activeIndex, items, onSelect }: CommandPaletteProps) {
  if (!visible) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.15 }}
      className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border bg-popover/95 shadow-xl backdrop-blur-md"
      role="listbox"
      aria-label="Copilot commands"
    >
      <div className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Copilot commands
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">No matching command</p>
      ) : (
        <ul className="lm-scroll max-h-64 overflow-y-auto p-1.5">
          {items.map((cmd, i) => (
            <li
              key={cmd.command}
              id={`copilot-cmd-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className="cursor-pointer"
              onMouseDown={(e) => {
                // mousedown (not click) so the textarea keeps focus
                e.preventDefault();
                onSelect(cmd);
              }}
            >
              <div
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                  i === activeIndex ? "bg-[var(--lm-brand-soft)]" : "hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                    i === activeIndex ? "bg-[var(--lm-brand)]/15 text-[var(--lm-brand)]" : "bg-muted text-muted-foreground",
                  )}
                >
                  <cmd.icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <span className="font-mono text-[var(--lm-brand)]">{cmd.command}</span>
                    <span className="ml-2 font-sans">{cmd.label}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{cmd.hint}</p>
                </div>
                {i === activeIndex && (
                  <span className="hidden shrink-0 items-center gap-1 text-[10px] text-muted-foreground sm:flex">
                    <CornerDownLeft className="h-3 w-3" aria-hidden="true" /> select
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export interface AnimatedAiChatProps {
  messages: ChatMsg[];
  loadingThread: boolean;
  sending: boolean;
  statusLine: string | null;
  pending: PendingCard | null;
  suggestions: string[];
  isDemo: boolean;
  contextLead: { id: string; label: string } | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onResolvePending: (action: "confirm" | "cancel") => void;
  onOpenContextLead?: () => void;
  onClearContext?: () => void;
  /** Extra header actions (e.g. mobile conversation-list toggle). */
  headerActions?: React.ReactNode;
  /** Extra classes for the root element. */
  className?: string;
}

export function AnimatedAiChat({
  messages,
  loadingThread,
  sending,
  statusLine,
  pending,
  suggestions,
  isDemo,
  contextLead,
  onSend,
  onStop,
  onRetry,
  onResolvePending,
  onOpenContextLead,
  onClearContext,
  headerActions,
  className,
}: AnimatedAiChatProps) {
  const reduced = useReducedMotion();

  const [input, setInput] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = React.useState(true);

  // ── Command palette state ────────────────────────────────────────────────
  const paletteOpen = input.startsWith("/") && !sending;
  const paletteQuery = paletteOpen ? input.slice(1).split(/\s/)[0]?.toLowerCase() ?? "" : "";
  const filteredCommands = React.useMemo(() => {
    if (!paletteOpen) return [];
    if (!paletteQuery) return COPILOT_COMMANDS;
    return COPILOT_COMMANDS.filter((c) => c.command.slice(1).startsWith(paletteQuery));
  }, [paletteOpen, paletteQuery]);
  const [activeCmdIndex, setActiveCmdIndex] = React.useState(0);

  React.useEffect(() => {
    setActiveCmdIndex(0);
  }, [paletteQuery]);

  // ── Auto-resizing composer ───────────────────────────────────────────────
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // ── Scroll behaviour: follow only when the user is already at the bottom ──
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  React.useEffect(() => {
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
    }
  }, [messages, statusLine, nearBottom, reduced]);

  const scrollToLatest = () => {
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  };

  const selectCommand = (cmd: CopilotCommand) => {
    if (cmd.send) {
      setInput("");
      onSend(cmd.send);
      textareaRef.current?.focus();
      return;
    }
    setInput(cmd.template);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const el = textareaRef.current;
      if (el) el.selectionStart = el.selectionEnd = el.value.length;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const trimmedInput = input.trim();
    // Exact command match (e.g. "/pipeline") → Enter sends instead of re-selecting.
    const exactCommand =
      paletteOpen &&
      trimmedInput.length > 1 &&
      filteredCommands.some((c) => c.command === trimmedInput);

    if (paletteOpen && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveCmdIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveCmdIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !exactCommand) {
        e.preventDefault();
        selectCommand(filteredCommands[activeCmdIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (trimmedInput) {
        setInput("");
        onSend(expandSlashCommand(trimmedInput));
      }
    }
  };

  const lastMsg = messages[messages.length - 1];
  const lastAssistantErrored = lastMsg?.role === "ASSISTANT" && !lastMsg.streaming && lastMsg.content.startsWith("**Error:**");
  const canRetry = !sending && messages.some((m) => m.role === "USER");

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", className)} data-chat-surface="">
      {/* ── Chat toolbar ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <LogoMark size={26} />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold">LeadMind Copilot</p>
            {contextLead ? (
              <p className="truncate text-xs text-muted-foreground">
                Context:{" "}
                <button type="button" className="font-medium text-[var(--lm-brand)] hover:underline" onClick={onOpenContextLead}>
                  {contextLead.label}
                </button>
                <button type="button" className="ml-2 text-muted-foreground hover:underline" onClick={onClearContext}>
                  clear
                </button>
              </p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                {isDemo ? "Local demo assistant — deterministic, live workspace data" : "Connected to external LLM"}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              isDemo
                ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                : "border-[var(--lm-brand)]/40 text-[var(--lm-brand)]",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isDemo ? "bg-amber-500" : "bg-[var(--lm-brand)] lm-pulse-dot")} aria-hidden="true" />
            {isDemo ? "DEMO" : "LIVE LLM"}
          </span>
          {canRetry && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onRetry}
              disabled={sending}
              aria-label="Regenerate last answer"
              title="Regenerate last answer"
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
          )}
          {headerActions}
        </div>
      </div>

      {/* ── Message stream ────────────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="lm-scroll absolute inset-0 overflow-y-auto">
          <div className="relative z-10 space-y-4 px-4 py-4">
            {loadingThread ? (
              <div className="space-y-3" aria-label="Loading conversation">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className={cn("h-16 rounded-2xl border border-border/60 bg-muted/40", i % 2 === 1 && "ml-auto w-3/4")}
                    style={{ width: i % 2 === 1 ? undefined : `${55 + i * 8}%` }}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: [0.4, 0.85, 0.4] }}
                    transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            ) : messages.length === 0 ? (
              <motion.div
                className="flex flex-col items-center py-12 text-center"
                initial={reduced ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="relative mb-4">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-full blur-2xl"
                    style={{ background: "radial-gradient(closest-side, var(--lm-brand-soft), transparent)" }}
                  />
                  <LogoMark size={56} />
                </div>
                <p className="font-display text-base font-bold">Ask your pipeline anything</p>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
                  The Copilot investigates real workspace data through validated tools — lead search,
                  scoring explanations, analytics, recommendations and knowledge retrieval. It never
                  invents records.
                </p>
                {suggestions.length > 0 && (
                  <div className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                    {suggestions.map((s, i) => (
                      <motion.button
                        key={i}
                        type="button"
                        onClick={() => onSend(expandSlashCommand(s))}
                        disabled={sending}
                        className="rounded-full border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur transition-colors hover:border-[var(--lm-brand)]/40 hover:text-[var(--lm-brand)] disabled:opacity-50"
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 + i * 0.05, duration: 0.3 }}
                      >
                        {s}
                      </motion.button>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <AnimatePresence initial={false} mode="popLayout">
                {messages.map((m) => (
                  <motion.div
                    key={m.id}
                    layout={!reduced}
                    variants={MESSAGE_VARIANTS}
                    initial={reduced ? false : "hidden"}
                    animate="show"
                    exit="exit"
                    className={cn("flex gap-3", m.role === "USER" ? "justify-end" : "justify-start")}
                  >
                    {m.role === "ASSISTANT" && (
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/25">
                        <LogoMark size={18} badge={false} />
                      </div>
                    )}
                    <div className={cn("min-w-0 max-w-[85%] space-y-2 sm:max-w-[78%]", m.role === "USER" && "flex flex-col items-end")}>
                      {m.toolTraces.length > 0 && <ToolTracePanel traces={m.toolTraces} />}
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-sm",
                          m.role === "USER"
                            ? "rounded-br-md bg-[linear-gradient(135deg,var(--lm-brand),color-mix(in_oklab,var(--lm-brand),var(--lm-info)_35%))] text-white shadow-[0_6px_18px_-8px_var(--lm-brand)]"
                            : "rounded-bl-md border border-border/70 bg-card/85 backdrop-blur-md",
                          m.streaming && m.content.length === 0 && "animate-pulse",
                        )}
                      >
                        {m.role === "USER" ? (
                          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        ) : (
                          <div className={cn(m.streaming && "lm-caret")}>
                            {m.content ? (
                              <Markdown content={m.content} />
                            ) : (
                              <TypingDots className="py-1" />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
                        <span>{new Date(m.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        {m.role === "ASSISTANT" && !m.streaming && m.content.length > 0 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded px-1 transition-colors hover:text-foreground"
                            aria-label="Copy response"
                            onClick={() => {
                              navigator.clipboard.writeText(m.content).then(
                                () => toast.success("Copied to clipboard"),
                                () => toast.error("Copy failed"),
                              );
                            }}
                          >
                            <Copy className="h-3 w-3" aria-hidden="true" /> copy
                          </button>
                        )}
                        {lastAssistantErrored && m === lastMsg && (
                          <button
                            type="button"
                            className="ml-auto inline-flex items-center gap-1 rounded px-1 font-medium text-[var(--lm-brand)] transition-colors hover:underline"
                            onClick={onRetry}
                            disabled={sending}
                          >
                            <RefreshCcw className="h-3 w-3" aria-hidden="true" /> Try again
                          </button>
                        )}
                      </div>
                    </div>
                    {m.role === "USER" && (
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            )}

            {/* Confirmation gate (existing pending-action protocol) */}
            <AnimatePresence>
              {pending && (
                <motion.div
                  key="pending"
                  initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.22 }}
                  className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-amber-500/40 bg-amber-50/80 backdrop-blur-md dark:bg-amber-950/30"
                  role="alertdialog"
                  aria-label="Confirmation required"
                >
                  <div className="space-y-3 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/15">
                        <ShieldQuestion className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                      </span>
                      Confirmation required
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{pending.summary}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => onResolvePending("confirm")}
                        className="bg-amber-600 text-white hover:bg-amber-500"
                      >
                        <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Confirm &amp; execute
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onResolvePending("cancel")}>
                        <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Cancel
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Assistant status line with animated indicator */}
            <AnimatePresence>
              {statusLine && (
                <motion.div
                  key="status"
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2.5 pl-10 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {statusLine.toLowerCase().includes("tool") ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--lm-brand)]" aria-hidden="true" />
                  ) : (
                    <TypingDots />
                  )}
                  <span>{statusLine}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={bottomRef} aria-hidden="true" />
          </div>
        </div>

        {/* Scroll-to-latest */}
        <AnimatePresence>
          {!nearBottom && messages.length > 0 && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2"
            >
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full bg-background/90 shadow-lg backdrop-blur"
                onClick={scrollToLatest}
                aria-label="Scroll to latest messages"
              >
                <ArrowDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Latest
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-border/70 p-3">
        <div className="relative">
          <CommandPalette
            visible={paletteOpen}
            activeIndex={activeCmdIndex}
            items={filteredCommands}
            onSelect={selectCommand}
          />

          <div className="flex items-end gap-2 rounded-xl border border-border/70 bg-card/70 p-2 shadow-sm backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-[var(--lm-brand)]/40 focus-within:shadow-[0_0_0_3px_var(--lm-brand-soft)]">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about leads, scores, predictions, actions…  Type / for commands"
              rows={1}
              aria-label="Message the copilot"
              className="max-h-[180px] min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
              disabled={sending}
            />
            {sending ? (
              <Button
                variant="destructive"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <LiquidGlassButton
                variant="brand"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  if (!input.trim()) return;
                  const text = expandSlashCommand(input.trim());
                  setInput("");
                  onSend(text);
                }}
                disabled={!input.trim()}
                aria-label="Send message"
                title="Send message (Enter)"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </LiquidGlassButton>
            )}
          </div>
        </div>

        <p className="mt-1.5 hidden items-center gap-3 px-1 text-[10px] text-muted-foreground sm:flex">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 font-mono text-[9px]">/</kbd> commands
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Enter</kbd> send
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 font-mono text-[9px]">Shift+Enter</kbd> newline
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Terminal className="h-3 w-3" aria-hidden="true" />
            Answers are grounded in validated tool output
          </span>
        </p>
      </div>
    </div>
  );
}


