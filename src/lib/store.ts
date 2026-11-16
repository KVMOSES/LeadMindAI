"use client";

import { create } from "zustand";

export type ViewKey =
  | "dashboard"
  | "leads"
  | "lead"
  | "profiles"
  | "qualification"
  | "copilot"
  | "actions"
  | "models"
  | "explainability"
  | "feedback"
  | "monitoring"
  | "settings";

export interface SessionData {
  user: { id: string; email: string; name: string | null; role: string };
  workspace: { id: string; name: string; slug: string };
  llmMode: "live" | "demo";
  hasProductionModel: boolean;
}

interface AppState {
  session: SessionData | null;
  setSession: (s: SessionData | null) => void;

  view: ViewKey;
  activeLeadId: string | null;
  leadContextId: string | null;
  conversationId: string | null;

  navigate: (view: ViewKey, opts?: { leadId?: string; conversationId?: string; leadContextId?: string }) => void;
  syncFromHash: () => void;
}

function hashFor(view: ViewKey, leadId?: string | null, conversationId?: string | null): string {
  switch (view) {
    case "lead":
      return leadId ? `#/leads/${leadId}` : "#/leads";
    case "copilot":
      return conversationId ? `#/copilot/${conversationId}` : "#/copilot";
    default:
      return `#/${view}`;
  }
}

export function parseHash(hash: string): { view: ViewKey; leadId?: string; conversationId?: string } {
  const h = hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts.length === 0) return { view: "dashboard" };
  const [head, id] = parts;
  if (head === "leads" && id) return { view: "lead", leadId: id };
  if (head === "copilot") return { view: "copilot", conversationId: id };
  const known: ViewKey[] = ["dashboard", "leads", "profiles", "qualification", "copilot", "actions", "models", "explainability", "feedback", "monitoring", "settings"];
  return { view: known.includes(head as ViewKey) ? (head as ViewKey) : "dashboard" };
}

export const useAppStore = create<AppState>((set) => ({
  session: null,
  setSession: (s) => set({ session: s }),

  view: "dashboard",
  activeLeadId: null,
  leadContextId: null,
  conversationId: null,

  navigate: (view, opts) => {
    if (opts?.leadId !== undefined) set({ activeLeadId: opts.leadId, leadContextId: opts.leadId });
    if (opts?.leadContextId !== undefined) set({ leadContextId: opts.leadContextId });
    if (opts?.conversationId !== undefined) set({ conversationId: opts.conversationId });
    set({ view });
    const newHash = hashFor(view, opts?.leadId ?? useAppStore.getState().activeLeadId, opts?.conversationId ?? useAppStore.getState().conversationId);
    if (typeof window !== "undefined" && window.location.hash !== newHash) {
      window.history.pushState(null, "", newHash);
    }
  },

  syncFromHash: () => {
    const parsed = parseHash(typeof window !== "undefined" ? window.location.hash : "");
    set({ view: parsed.view, activeLeadId: parsed.leadId ?? null, conversationId: parsed.conversationId ?? null, leadContextId: parsed.leadId ?? null });
  },
}));
