"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionData } from "@/lib/store";
import { useAppStore } from "@/lib/store";
import { api, fmtDateTime, fmtRelative } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  MessageSquarePlus,
  RefreshCcw,
  Send,
  Trash2,
  User,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Markdown, EmptyState } from "@/components/lm/shared";
import { LiquidGlassButton } from "@/components/ui/liquid-glass-button";

interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  ms: number;
}

interface ChatMsg {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  toolTraces: ToolTrace[];
  createdAt: string;
  streaming?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
  firstMessage: string;
}

interface PendingCard {
  pendingActionId: string;
  summary: string;
}

export function CopilotView({ session }: { session: SessionData }) {
  const conversationId = useAppStore((s) => s.conversationId);
  const leadContextId = useAppStore((s) => s.leadContextId);
  const navigate = useAppStore((s) => s.navigate);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCard | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [contextLead, setContextLead] = useState<{ id: string; label: string } | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, statusLine]);

  const newConversation = async () => {
    try {
      const res = await api<{ conversation: { id: string } }>("/api/chat/conversations", { method: "POST", body: {} });
      await loadConversations();
      navigate("copilot", { conversationId: res.conversation.id });
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
    setInput("");
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

  return (
    <div className="flex h-[calc(100vh-11.5rem)] min-h-[32rem] flex-col gap-4 lg:flex-row">
      {/* Conversation list */}
      <aside className={cn("w-full shrink-0 lg:w-64", mobileListOpen ? "block" : "hidden lg:block")}>
        <Card className="flex h-full flex-col p-0 gap-0">
          <div className="flex items-center justify-between p-3">
            <p className="text-sm font-medium">Conversations</p>
            <Button size="sm" variant="outline" className="h-8" onClick={newConversation}>
              <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> New
            </Button>
          </div>
          <Separator />
          <ScrollArea className="h-full max-h-[calc(100vh-16rem)] flex-1 lm-scroll">
            <div className="space-y-1 p-2">
              {conversations.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No conversations yet</p>}
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex cursor-pointer items-start justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                    conversationId === c.id ? "bg-[var(--lm-brand-soft)] text-[var(--lm-brand)]" : "hover:bg-muted",
                  )}
                  onClick={() => {
                    navigate("copilot", { conversationId: c.id });
                    setMobileListOpen(false);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && navigate("copilot", { conversationId: c.id })}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{fmtRelative(c.updatedAt)} · {c.mode === "DEMO" ? "demo" : "llm"}</p>
                  </div>
                  <button
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                    aria-label={`Delete conversation ${c.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </aside>

      {/* Chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col p-0 gap-0">
          {/* Chat header */}
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/30">
                <BrainCircuit className="h-4 w-4 text-[var(--lm-brand)]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">LeadMind Copilot</p>
                {contextLead ? (
                  <p className="truncate text-xs text-muted-foreground">
                    Context: {contextLead.label}
                    <button className="ml-2 text-[var(--lm-brand)] hover:underline" onClick={() => navigate("lead", { leadId: contextLead.id })}>
                      open profile
                    </button>
                    <button className="ml-2 text-muted-foreground hover:underline" onClick={() => navigate("copilot")}>
                      clear
                    </button>
                  </p>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">{isDemo ? "Local demo assistant — deterministic, live workspace data" : "Connected to external LLM"}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("text-[10px]", isDemo ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "border-[var(--lm-brand)]/40 text-[var(--lm-brand)]")}>
                {isDemo ? "DEMO MODE" : "LIVE LLM"}
              </Badge>
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={regenerate} disabled={sending} aria-label="Regenerate last answer" title="Regenerate last answer">
                  <RefreshCcw className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={() => setMobileListOpen((v) => !v)} aria-label="Toggle conversation list">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="min-h-0 flex-1 lm-scroll">
            <div className="space-y-4 px-4 py-4">
              {loadingThread ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-2/3" />
                  <Skeleton className="ml-auto h-24 w-3/4" />
                  <Skeleton className="h-16 w-1/2" />
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10">
                  <EmptyState
                    icon={<BrainCircuit className="h-10 w-10" />}
                    title="Ask your pipeline anything"
                    description="The Copilot investigates real workspace data through validated tools — lead search, scoring explanations, analytics, recommendations and knowledge retrieval. It never invents records."
                  />
                  {suggestions.length > 0 && (
                    <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => send(s)}
                          disabled={sending}
                          className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[var(--lm-brand)]/40 hover:text-[var(--lm-brand)]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={cn("flex gap-3", m.role === "USER" ? "justify-end" : "justify-start")}>
                    {m.role === "ASSISTANT" && (
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--lm-brand-soft)] ring-1 ring-[var(--lm-brand)]/30">
                        <BrainCircuit className="h-4 w-4 text-[var(--lm-brand)]" />
                      </div>
                    )}
                    <div className={cn("max-w-[85%] space-y-2 sm:max-w-[80%]", m.role === "USER" && "flex flex-col items-end")}>
                      {m.toolTraces.length > 0 && <ToolTracePanel traces={m.toolTraces} />}
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3",
                          m.role === "USER"
                            ? "bg-[var(--lm-brand)] text-[var(--primary-foreground)]"
                            : "lm-panel border bg-card",
                          m.streaming && m.content.length === 0 && "animate-pulse",
                        )}
                      >
                        {m.role === "USER" ? (
                          <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                        ) : (
                          <div className={cn(m.streaming && "lm-caret")}>
                            {m.content ? <Markdown content={m.content} /> : <p className="text-sm text-muted-foreground">…</p>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
                        <span>{fmtDateTime(m.createdAt)}</span>
                        {m.role === "ASSISTANT" && !m.streaming && m.content.length > 0 && (
                          <button
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            aria-label="Copy response"
                            onClick={() => {
                              navigator.clipboard.writeText(m.content).then(
                                () => toast.success("Copied to clipboard"),
                                () => toast.error("Copy failed"),
                              );
                            }}
                          >
                            <Copy className="h-3 w-3" /> copy
                          </button>
                        )}
                      </div>
                    </div>
                    {m.role === "USER" && (
                      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))
              )}

              {pending && (
                <Card className="mx-auto w-full max-w-lg border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/30">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      Confirmation required
                    </div>
                    <p className="text-sm text-muted-foreground">{pending.summary}</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => resolvePending("confirm")} className="bg-amber-600 text-white hover:bg-amber-500">
                        <Check className="mr-1 h-3.5 w-3.5" /> Confirm & execute
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resolvePending("cancel")}>
                        <X className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {statusLine && (
                <div className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--lm-brand)]" /> {statusLine}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t p-3">
            {messages.length === 0 && suggestions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 lg:hidden">
                {suggestions.slice(0, 3).map((s, i) => (
                  <button key={i} onClick={() => send(s)} disabled={sending} className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask about leads, scores, predictions, actions… (Enter to send, Shift+Enter for newline)"
                className="min-h-[2.75rem] flex-1 resize-none"
                rows={1}
                aria-label="Message the copilot"
                disabled={sending}
              />
              {sending ? (
                <Button variant="destructive" size="icon" className="h-11 w-11" onClick={stop} aria-label="Stop generating">
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <LiquidGlassButton
                  variant="brand"
                  size="icon"
                  className="h-11 w-11"
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </LiquidGlassButton>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ToolTracePanel({ traces }: { traces: ToolTrace[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full rounded-lg border bg-muted/40 text-xs">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Wrench className="h-3.5 w-3.5 text-[var(--lm-brand)]" />
        <span className="font-medium">{traces.length} tool execution{traces.length > 1 ? "s" : ""}</span>
        <span className="truncate text-muted-foreground">{traces.map((t) => t.name).join(", ")}</span>
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t px-3 py-2">
          {traces.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", t.ok ? "bg-emerald-500" : "bg-rose-500")} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px]">{t.name} <span className="text-muted-foreground">({t.ms}ms)</span></p>
                <p className="truncate text-muted-foreground">{t.ok ? t.summary : t.summary}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
