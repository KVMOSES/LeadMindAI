"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionData } from "@/lib/store";
import { useAppStore } from "@/lib/store";
import { api, fmtRelative } from "@/lib/api";
import { LiquidGlassButton } from "@/components/ui/liquid-glass-button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquarePlus,
  PanelLeft,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AnimatedAiChat,
  type ChatMsg,
  type PendingCard,
  type ToolTrace,
} from "@/components/ui/animated-ai-chat";

/**
 * CopilotView — owns the real Copilot behaviour (conversation persistence,
 * SSE streaming, tool traces, confirmation-gated pending actions, RBAC via
 * session cookie, lead context). Presentation is delegated to
 * `AnimatedAiChat` plus a dedicated conversation rail; no chat behaviour is
 * simulated here.
 */

interface ConversationSummary {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
  firstMessage: string;
}

type ConversationGroup = "Today" | "Yesterday" | "Previous 7 days" | "Older";

function conversationGroup(iso: string): ConversationGroup {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - 86_400_000) return "Yesterday";
  if (t >= startOfToday - 7 * 86_400_000) return "Previous 7 days";
  return "Older";
}

const GROUP_ORDER: ConversationGroup[] = ["Today", "Yesterday", "Previous 7 days", "Older"];

export function CopilotView({ session }: { session: SessionData }) {
  const conversationId = useAppStore((s) => s.conversationId);
  const leadContextId = useAppStore((s) => s.leadContextId);
  const navigate = useAppStore((s) => s.navigate);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCard | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [contextLead, setContextLead] = useState<{ id: string; label: string } | null>(null);
  const [railQuery, setRailQuery] = useState("");
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // When send() creates a fresh conversation we optimistically append messages;
  // the conversationId effect must not clobber them with an empty server thread.
  const skipThreadLoadRef = useRef(false);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api<{ conversations: ConversationSummary[] }>("/api/chat/conversations");
      setConversations(res.conversations);
    } catch {
      // sidebar is non-critical
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    api<{ suggestions: string[] }>(`/api/chat/suggestions?page=copilot${leadContextId ? `&leadId=${leadContextId}` : ""}`)
      .then((r) => setSuggestions(r.suggestions))
      .catch(() => setSuggestions([]));
  }, [leadContextId]);

  useEffect(() => {
    if (!leadContextId) {
      setContextLead(null);
      return;
    }
    api<{ detail: { lead: { contactName: string; company: { name: string } | null } } }>(`/api/leads/${leadContextId}`)
      .then((r) => setContextLead({ id: leadContextId, label: `${r.detail.lead.contactName} — ${r.detail.lead.company?.name ?? "unknown"}` }))
      .catch(() => setContextLead(null));
  }, [leadContextId]);

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    setPending(null);
    try {
      const res = await api<{
        conversation: { id: string; title: string; mode: string; messages: { id: string; role: "USER" | "ASSISTANT"; content: string; toolTraces: ToolTrace[]; createdAt: string }[] };
      }>(`/api/chat/conversations/${id}`);
      setMessages(res.conversation.messages);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load conversation");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      if (skipThreadLoadRef.current) {
        skipThreadLoadRef.current = false;
        return;
      }
      loadThread(conversationId);
    } else {
      setMessages([]);
    }
  }, [conversationId, loadThread]);

  const newConversation = async () => {
    try {
      const res = await api<{ conversation: { id: string } }>("/api/chat/conversations", { method: "POST", body: {} });
      await loadConversations();
      navigate("copilot", { conversationId: res.conversation.id });
      setMobileRailOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create conversation");
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api(`/api/chat/conversations/${id}`, { method: "DELETE" });
      if (conversationId === id) {
        navigate("copilot");
        setMessages([]);
      }
      await loadConversations();
      toast.success("Conversation deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const selectConversation = (id: string) => {
    navigate("copilot", { conversationId: id });
    setMobileRailOpen(false);
  };

  // ── Streaming send ─────────────────────────────────────────────────────────

  const send = async (content: string) => {
    if (!content.trim() || sending) return;
    let convId = conversationId;
    if (!convId) {
      try {
        const res = await api<{ conversation: { id: string } }>("/api/chat/conversations", { method: "POST", body: {} });
        convId = res.conversation.id;
        skipThreadLoadRef.current = true;
        navigate("copilot", { conversationId: convId });
        await loadConversations();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not create conversation");
        return;
      }
    }
    setSending(true);
    setPending(null);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: "USER", content, toolTraces: [], createdAt: new Date().toISOString() },
      { id: "streaming", role: "ASSISTANT", content: "", toolTraces: [], createdAt: new Date().toISOString(), streaming: true },
    ]);
    setStatusLine("Thinking…");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, leadContextId: leadContextId ?? undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Chat failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let answerDone = false;

      const handleEvent = (ev: Record<string, unknown>) => {
        const type = ev.type as string;
        if (type === "status") {
          const stage = ev.stage as string;
          if (stage === "executing_tool") setStatusLine(`Running tool: ${ev.tool}`);
          else if (stage === "answering") setStatusLine(null);
          else if (stage === "finalizing") setStatusLine("Finalizing answer…");
          else if (stage === "demo_reasoning") setStatusLine("Demo assistant analysing workspace data…");
          else if (stage?.includes("falling_back")) setStatusLine("External LLM unavailable — using local demo assistant…");
          else setStatusLine("Thinking…");
        } else if (type === "tools") {
          const traces = ev.traces as ToolTrace[];
          setStatusLine(null);
          setMessages((m) =>
            m.map((msg) => (msg.id === "streaming" ? { ...msg, toolTraces: [...msg.toolTraces, ...traces] } : msg)),
          );
        } else if (type === "delta") {
          setStatusLine(null);
          const text = ev.text as string;
          setMessages((m) => m.map((msg) => (msg.id === "streaming" ? { ...msg, content: msg.content + text } : msg)));
        } else if (type === "pending_action") {
          setPending({ pendingActionId: ev.pendingActionId as string, summary: ev.summary as string });
        } else if (type === "done") {
          answerDone = true;
          setStatusLine(null);
          const finalId = (ev.messageId as string) ?? `done-${Date.now()}`;
          const traces = (ev.traces as ToolTrace[]) ?? [];
          setMessages((m) =>
            m.map((msg) => (msg.id === "streaming" ? { ...msg, id: finalId, toolTraces: traces, streaming: false } : msg)),
          );
          if (ev.title) loadConversations();
        } else if (type === "error") {
          answerDone = true;
          setStatusLine(null);
          setMessages((m) =>
            m.map((msg) =>
              msg.id === "streaming"
                ? { ...msg, id: `err-${Date.now()}`, streaming: false, content: msg.content || `**Error:** ${ev.message}` }
                : msg,
            ),
          );
          toast.error((ev.message as string) ?? "Chat error");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (raw.startsWith("data:")) {
            try {
              handleEvent(JSON.parse(raw.slice(5).trim()));
            } catch {
              // malformed event
            }
          }
        }
      }
      if (!answerDone) {
        setMessages((m) => m.map((msg) => (msg.id === "streaming" ? { ...msg, streaming: false } : msg)));
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setMessages((m) => m.map((msg) => (msg.id === "streaming" ? { ...msg, streaming: false, content: msg.content || "_Stopped._" } : msg)));
      } else {
        const msg = e instanceof Error ? e.message : "Chat failed";
        setMessages((m) => m.map((m2) => (m2.id === "streaming" ? { ...m2, streaming: false, content: `**Error:** ${msg}` } : m2)));
        toast.error(msg);
      }
    } finally {
      setSending(false);
      setStatusLine(null);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const resolvePending = async (action: "confirm" | "cancel") => {
    if (!pending) return;
    try {
      const res = await api<{ result?: { ok: boolean; summary: string }; cancelled?: boolean }>(`/api/chat/pending/${pending.pendingActionId}`, {
        method: "POST",
        body: { action },
      });
      if (action === "confirm") {
        if (res.result?.ok) toast.success(res.result.summary);
        else toast.error(res.result?.summary ?? "Action failed");
        setMessages((m) => [
          ...m,
          {
            id: `sys-${Date.now()}`,
            role: "ASSISTANT",
            content: res.result?.ok
              ? `**Action executed.** ${res.result.summary}`
              : `**Action failed.** ${res.result?.summary ?? "Unknown error"}`,
            toolTraces: [],
            createdAt: new Date().toISOString(),
          },
        ]);
      } else {
        toast.info("Action cancelled — nothing was changed");
        setMessages((m) => [
          ...m,
          { id: `sys-${Date.now()}`, role: "ASSISTANT", content: "**Cancelled.** No changes were made.", toolTraces: [], createdAt: new Date().toISOString() },
        ]);
      }
      setPending(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resolve action");
    }
  };

  const regenerate = async () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "USER");
    if (!lastUser) return;
    setMessages((m) => (m[m.length - 1]?.role === "ASSISTANT" ? m.slice(0, -1) : m));
    await send(lastUser.content);
  };

  const isDemo = session.llmMode === "demo";
  const activeConversation = conversations.find((c) => c.id === conversationId) ?? null;

  // Real client-side filter over the loaded conversation list.
  const filteredGroups = useMemo(() => {
    const q = railQuery.trim().toLowerCase();
    const visible = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.firstMessage.toLowerCase().includes(q))
      : conversations;
    const map = new Map<ConversationGroup, ConversationSummary[]>();
    for (const c of visible) {
      const g = conversationGroup(c.updatedAt);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
  }, [conversations, railQuery]);

  const renderConversationList = (variant: "rail" | "sheet") => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 px-3 pb-3">
        <LiquidGlassButton
          variant="brand"
          className="w-full"
          onClick={newConversation}
          disabled={sending}
          aria-label="Start a new conversation"
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          New conversation
        </LiquidGlassButton>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--sidebar-foreground)]/50"
            aria-hidden="true"
          />
          <Input
            value={railQuery}
            onChange={(e) => setRailQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-8 rounded-lg border-[var(--sidebar-border)] bg-white/5 pl-8 pr-7 text-xs text-[var(--sidebar-foreground)] placeholder:text-[var(--sidebar-foreground)]/40"
          />
          {railQuery && (
            <button
              type="button"
              onClick={() => setRailQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--sidebar-foreground)]/55 transition-colors hover:text-[var(--sidebar-foreground)]"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className={cn("lm-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3", variant === "sheet" && "max-h-[60vh]")}>
        {loadingThread && conversations.length === 0 ? (
          <div className="space-y-2 px-1 py-1">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs font-medium">No conversations yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--sidebar-foreground)]/55">
              Start one — the Copilot answers from live workspace data.
            </p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-[var(--sidebar-foreground)]/55">No matches for “{railQuery.trim()}”</p>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="px-2 pb-1 pt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--sidebar-foreground)]/45">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((c) => {
                  const active = c.id === conversationId;
                  return (
                    <li key={c.id} className="group/item relative">
                      <button
                        type="button"
                        onClick={() => selectConversation(c.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 pr-9 text-left transition-all",
                          active
                            ? "bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/25"
                            : "text-[var(--sidebar-foreground)] hover:bg-[var(--lm-sidebar-hover)]",
                        )}
                      >
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-[var(--lm-brand)] to-[var(--lm-info)]"
                          />
                        )}
                        <span className="flex items-center gap-1.5">
                          {sending && active && (
                            <span aria-hidden="true" className="lm-pulse-dot size-1.5 shrink-0 rounded-full bg-[var(--lm-lime)]" />
                          )}
                          <span className={cn("truncate text-[13px] font-medium", active && "text-[var(--lm-brand)]")}>
                            {c.title}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--sidebar-foreground)]/55">
                          <span>{fmtRelative(c.updatedAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-mono uppercase tracking-wide",
                              c.mode === "DEMO" ? "text-amber-600 dark:text-amber-400" : "text-[var(--lm-brand)]",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn("size-1 rounded-full", c.mode === "DEMO" ? "bg-amber-500" : "bg-[var(--lm-brand)]")}
                            />
                            {c.mode === "DEMO" ? "demo" : "llm"}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-[var(--lm-sidebar)]/80 p-1.5 text-[var(--sidebar-foreground)]/55 opacity-0 transition-opacity hover:bg-rose-500/15 hover:text-rose-400 focus-visible:opacity-100 group-hover/item:opacity-100"
                        aria-label={`Delete conversation ${c.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(c.id);
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[34rem] overflow-hidden rounded-2xl border border-border/80 lm-panel">
      {/* ── Conversation rail (desktop) ─────────────────────────────────────── */}
      <aside
        className="hidden w-72 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--lm-sidebar)] text-[var(--sidebar-foreground)] lg:flex"
        aria-label="Conversations"
      >
        <div className="flex h-[3.25rem] items-center gap-2 border-b border-[var(--sidebar-border)] px-3.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/25">
            <MessageSquarePlus className="size-3.5 text-[var(--lm-brand)]" aria-hidden="true" />
          </span>
          <p className="font-display text-[13px] font-bold tracking-tight">Conversations</p>
          <span className="ml-auto rounded-full border border-[var(--sidebar-border)] bg-white/5 px-2 py-0.5 font-mono text-[10px] tabular-nums text-[var(--sidebar-foreground)]/70">
            {conversations.length}
          </span>
        </div>
        {renderConversationList("rail")}
      </aside>

      {/* ── Chat workspace ──────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col" data-copilot-workspace="">
        <AnimatedAiChat
          className="min-h-0 flex-1"
          messages={messages}
          loadingThread={loadingThread}
          sending={sending}
          statusLine={statusLine}
          pending={pending}
          suggestions={suggestions}
          isDemo={isDemo}
          contextLead={contextLead}
          conversationTitle={activeConversation?.title ?? null}
          onSend={(text) => void send(text)}
          onStop={stop}
          onRetry={() => void regenerate()}
          onResolvePending={(action) => void resolvePending(action)}
          onOpenContextLead={() => contextLead && navigate("lead", { leadId: contextLead.id })}
          onClearContext={() => navigate("copilot")}
          headerActions={
            <LiquidGlassButton
              variant="outline"
              size="icon"
              className="size-8 lg:hidden"
              onClick={() => setMobileRailOpen(true)}
              aria-label="Open conversation list"
              title="Conversations"
            >
              <PanelLeft className="size-4" aria-hidden="true" />
            </LiquidGlassButton>
          }
        />
      </div>

      {/* ── Conversation rail (mobile sheet) ────────────────────────────────── */}
      <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
        <SheetContent side="left" className="flex w-80 flex-col gap-0 border-[var(--sidebar-border)] bg-[var(--lm-sidebar)] p-0 text-[var(--sidebar-foreground)]">
          <SheetHeader className="border-b border-[var(--sidebar-border)] px-3.5 py-3">
            <SheetTitle className="flex items-center gap-2 font-display text-[13px] font-bold tracking-tight">
              <span className="flex size-7 items-center justify-center rounded-md bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/25">
                <MessageSquarePlus className="size-3.5 text-[var(--lm-brand)]" aria-hidden="true" />
              </span>
              Conversations
              <span className="ml-auto rounded-full border border-[var(--sidebar-border)] bg-white/5 px-2 py-0.5 font-mono text-[10px] tabular-nums text-[var(--sidebar-foreground)]/70">
                {conversations.length}
              </span>
            </SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col pt-3">
            {renderConversationList("sheet")}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
