"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionData } from "@/lib/store";
import { useAppStore } from "@/lib/store";
import { api, fmtRelative } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  MessageSquarePlus,
  MessagesSquare,
  Trash2,
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
 * `AnimatedAiChat`; no chat behaviour is simulated here.
 */

interface ConversationSummary {
  id: string;
  title: string;
  mode: string;
  updatedAt: string;
  firstMessage: string;
}

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
  const [mobileListOpen, setMobileListOpen] = useState(false);
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
        <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card/70 backdrop-blur-md">
          <div className="flex items-center justify-between p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <MessagesSquare className="h-4 w-4 text-[var(--lm-brand)]" aria-hidden="true" />
              Conversations
            </p>
            <Button size="sm" variant="outline" className="h-8" onClick={newConversation}>
              <MessageSquarePlus className="mr-1 h-3.5 w-3.5" /> New
            </Button>
          </div>
          <div className="h-px bg-border" aria-hidden="true" />
          <ScrollArea className="h-full max-h-[calc(100vh-16rem)] flex-1 lm-scroll">
            <div className="space-y-1 p-2">
              {loadingThread && conversations.length === 0 && (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
              {conversations.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">No conversations yet</p>
              )}
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex cursor-pointer items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    conversationId === c.id
                      ? "bg-[var(--lm-brand-soft)] text-[var(--lm-brand)]"
                      : "hover:bg-muted/70",
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
                    <p className="truncate text-xs text-muted-foreground">
                      {fmtRelative(c.updatedAt)} · {c.mode === "DEMO" ? "demo" : "llm"}
                    </p>
                  </div>
                  <button
                    className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100"
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
        </div>
      </aside>

      {/* Animated chat surface */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card/60 shadow-sm backdrop-blur-md">
          <AnimatedAiChat
            className="flex-1"
            messages={messages}
            loadingThread={loadingThread}
            sending={sending}
            statusLine={statusLine}
            pending={pending}
            suggestions={suggestions}
            isDemo={isDemo}
            contextLead={contextLead}
            onSend={(text) => void send(text)}
            onStop={stop}
            onRetry={() => void regenerate()}
            onResolvePending={(action) => void resolvePending(action)}
            onOpenContextLead={() => contextLead && navigate("lead", { leadId: contextLead.id })}
            onClearContext={() => navigate("copilot")}
            headerActions={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 lg:hidden"
                onClick={() => setMobileListOpen((v) => !v)}
                aria-label="Toggle conversation list"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}
