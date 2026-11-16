"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionData } from "@/lib/store";
import { api, fmtDateTime } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, FileText, Loader2, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/lm/shared";

interface IcpData {
  targetIndustries: string[];
  employeeRange: { min: number; max: number };
  revenueBands: string[];
  countries: string[];
  businessModels: string[];
  dealValueRange: { min: number; max: number };
  weights: { industry: number; size: number; revenue: number; geo: number; businessModel: number; dealValue: number; completeness: number };
  requiredFields: string[];
}
interface IntentData {
  weights: Record<string, number>;
  halfLifeDays: number;
  saturationK: number;
  maxPerTypePerDay: number;
  dedupeMinutes: number;
  recencyBoost: { within7d: number; within30d: number };
  inactivityPenalty: { afterDays: number; amount: number };
}
interface Thresholds {
  salesReadyFit: number;
  salesReadyIntent: number;
  salesReadyProbability: number;
  nurtureFit: number;
  keepWarmFit: number;
  lowQualityFloor: number;
}
interface MemoryItem {
  id: string;
  scope: string;
  key: string;
  value: string;
  approved: boolean;
  source: string;
  lead: string | null;
  updatedAt: string;
}
interface KnowledgeDoc {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  status: string;
  chunkCount: number;
  error: string | null;
  createdAt: string;
}

const INDUSTRY_OPTIONS = ["SaaS", "FinTech", "Healthcare IT", "E-commerce", "Logistics", "Manufacturing", "Media", "Education", "Energy"];
const REVENUE_OPTIONS = ["<1M", "1M-10M", "10M-50M", "50M-100M", "100M+"];
const COUNTRY_OPTIONS = ["United States", "Canada", "United Kingdom", "Germany", "Australia", "Singapore"];
const MODEL_OPTIONS = ["B2B_SAAS", "ENTERPRISE", "MARKETPLACE", "B2C", "AGENCY", "OTHER"];
const FIELD_OPTIONS = ["email", "phone", "title", "industry", "employeeCount", "revenueBand", "country", "businessModel", "dealValue"];
const EVENT_TYPES = ["WEBSITE_VISIT", "PRICING_VISIT", "PRODUCT_VISIT", "DEMO_REQUEST", "EMAIL_OPEN", "EMAIL_CLICK", "SOCIAL_ENGAGEMENT", "FORM_SUBMIT", "NEGATIVE_FEEDBACK", "UNSUBSCRIBE"];

function ChipSelect({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            aria-pressed={on}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              on ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground hover:border-foreground/30",
            )}
          >
            {on && <Check className="mr-1 inline h-3 w-3" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsView({ session }: { session: SessionData }) {
  const isAdmin = session.user.role === "ADMIN";
  const isViewer = session.user.role === "VIEWER";
  const [tab, setTab] = useState("icp");
  const [loading, setLoading] = useState(true);

  const [icp, setIcp] = useState<IcpData | null>(null);
  const [icpVersion, setIcpVersion] = useState("");
  const [intent, setIntent] = useState<IntentData | null>(null);
  const [intentVersion, setIntentVersion] = useState("");
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [productInfo, setProductInfo] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);

  const [saving, setSaving] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [icpRes, intentRes, settingsRes, memRes, docsRes] = await Promise.all([
        api<{ icp: IcpData; version: string }>("/api/workspace/icp"),
        api<{ intent: IntentData; version: string }>("/api/workspace/intent"),
        api<{ thresholds: Thresholds; productInfo: string }>("/api/workspace/settings"),
        api<{ memories: MemoryItem[] }>("/api/workspace/memory"),
        api<{ documents: KnowledgeDoc[] }>("/api/knowledge"),
      ]);
      setIcp(icpRes.icp);
      setIcpVersion(icpRes.version);
      setIntent(intentRes.intent);
      setIntentVersion(intentRes.version);
      setThresholds(settingsRes.thresholds);
      setProductInfo(settingsRes.productInfo);
      setMemories(memRes.memories);
      setDocs(docsRes.documents);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const saveIcp = async () => {
    if (!icp) return;
    setSaving("icp");
    try {
      const res = await api<{ version: number }>("/api/workspace/icp", { method: "PUT", body: icp });
      setIcpVersion(`v${res.version}`);
      toast.success(`ICP saved as version v${res.version} — next assessments use it automatically`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const saveIntent = async () => {
    if (!intent) return;
    setSaving("intent");
    try {
      const res = await api<{ version: number }>("/api/workspace/intent", { method: "PUT", body: intent });
      setIntentVersion(`v${res.version}`);
      toast.success(`Intent configuration saved as v${res.version}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const saveQual = async () => {
    if (!thresholds) return;
    setSaving("qual");
    try {
      await api("/api/workspace/settings", { method: "PUT", body: { thresholds, productInfo: { summary: productInfo } } });
      toast.success("Qualification thresholds and product info saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const toggleMemory = async (id: string, approved: boolean) => {
    try {
      await api("/api/workspace/memory", { method: "PATCH", body: { id, approved } });
      setMemories((ms) => ms.map((m) => (m.id === id ? { ...m, approved } : m)));
      toast.success(approved ? "Memory approved — Copilot context updated" : "Memory revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const deleteMemory = async (id: string) => {
    try {
      await api(`/api/workspace/memory?id=${id}`, { method: "DELETE" });
      setMemories((ms) => ms.filter((m) => m.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const addMemory = async (content: string, scope: string) => {
    try {
      await api("/api/workspace/memory", { method: "POST", body: { content, scope } });
      const res = await api<{ memories: MemoryItem[] }>("/api/workspace/memory");
      setMemories(res.memories);
      setMemoryOpen(false);
      toast.success("Memory stored as pending — approve it to activate in Copilot context");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const deleteDoc = async (id: string) => {
    try {
      await api(`/api/knowledge/${id}`, { method: "DELETE" });
      setDocs((d) => d.filter((x) => x.id !== id));
      toast.success("Document removed from the knowledge base");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Settings" description="Configure the intelligence engines, knowledge base and conversational memory. Changes are versioned and audit-logged." />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9 flex-wrap">
          <TabsTrigger value="icp">ICP</TabsTrigger>
          <TabsTrigger value="intent">Intent weights</TabsTrigger>
          <TabsTrigger value="qualification">Qualification</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge base</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="chatbot">Chatbot</TabsTrigger>
        </TabsList>

        {/* ICP */}
        <TabsContent value="icp" className="mt-4 space-y-4">
          <Card className="p-0 gap-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Ideal Customer Profile {icpVersion && <Badge variant="outline" className="ml-2">{icpVersion}</Badge>}</CardTitle>
              <CardDescription>Drives the customer-fit score. Saving creates a new version; older assessments keep their original configuration reference.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {icp && (
                <>
                  <div className="space-y-1.5">
                    <Label>Target industries</Label>
                    <ChipSelect options={INDUSTRY_OPTIONS} selected={icp.targetIndustries} onToggle={(v) => setIcp({ ...icp, targetIndustries: icp.targetIndustries.includes(v) ? icp.targetIndustries.filter((x) => x !== v) : [...icp.targetIndustries, v] })} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="empMin">Employees min</Label>
                      <Input id="empMin" type="number" value={icp.employeeRange.min} onChange={(e) => setIcp({ ...icp, employeeRange: { ...icp.employeeRange, min: Number(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="empMax">Employees max</Label>
                      <Input id="empMax" type="number" value={icp.employeeRange.max} onChange={(e) => setIcp({ ...icp, employeeRange: { ...icp.employeeRange, max: Number(e.target.value) || 1 } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dvMin">Deal value min (USD)</Label>
                      <Input id="dvMin" type="number" value={icp.dealValueRange.min} onChange={(e) => setIcp({ ...icp, dealValueRange: { ...icp.dealValueRange, min: Number(e.target.value) || 0 } })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Revenue bands</Label>
                    <ChipSelect options={REVENUE_OPTIONS} selected={icp.revenueBands} onToggle={(v) => setIcp({ ...icp, revenueBands: icp.revenueBands.includes(v) ? icp.revenueBands.filter((x) => x !== v) : [...icp.revenueBands, v] })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Preferred countries</Label>
                    <ChipSelect options={COUNTRY_OPTIONS} selected={icp.countries} onToggle={(v) => setIcp({ ...icp, countries: icp.countries.includes(v) ? icp.countries.filter((x) => x !== v) : [...icp.countries, v] })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Compatible business models</Label>
                    <ChipSelect options={MODEL_OPTIONS} selected={icp.businessModels} onToggle={(v) => setIcp({ ...icp, businessModels: icp.businessModels.includes(v) ? icp.businessModels.filter((x) => x !== v) : [...icp.businessModels, v] })} />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Score weights (relative)</Label>
                    <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {(Object.keys(icp.weights) as (keyof IcpData["weights"])[]).map((k) => (
                        <div key={k} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 text-xs capitalize text-muted-foreground">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                          <input
                            type="range"
                            min={0}
                            max={40}
                            value={icp.weights[k]}
                            onChange={(e) => setIcp({ ...icp, weights: { ...icp.weights, [k]: Number(e.target.value) } })}
                            className="flex-1 accent-emerald-600"
                            aria-label={`${k} weight`}
                          />
                          <span className="w-8 text-right text-xs tabular-nums">{icp.weights[k]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Required fields (data completeness)</Label>
                    <ChipSelect options={FIELD_OPTIONS} selected={icp.requiredFields} onToggle={(v) => setIcp({ ...icp, requiredFields: icp.requiredFields.includes(v) ? icp.requiredFields.filter((x) => x !== v) : [...icp.requiredFields, v] })} />
                  </div>
                  {isAdmin ? (
                    <Button onClick={saveIcp} disabled={saving === "icp"}>
                      {saving === "icp" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save as new version
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Admin role required to change the ICP.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Intent */}
        <TabsContent value="intent" className="mt-4 space-y-4">
          <Card className="p-0 gap-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Buying intent engine {intentVersion && <Badge variant="outline" className="ml-2">{intentVersion}</Badge>}</CardTitle>
              <CardDescription>Event weights, time decay and frequency controls. Negative weights reduce intent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {intent && (
                <>
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {EVENT_TYPES.map((t) => (
                      <div key={t} className="flex items-center gap-3">
                        <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">{t.replaceAll("_", " ").toLowerCase()}</span>
                        <Input
                          type="number"
                          className="h-8 w-24 text-xs"
                          value={intent.weights[t] ?? 0}
                          onChange={(e) => setIntent({ ...intent, weights: { ...intent.weights, [t]: Number(e.target.value) } })}
                          aria-label={`${t} weight`}
                        />
                      </div>
                    ))}
                  </div>
                  <Separator />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="halfLife">Half-life (days)</Label>
                      <Input id="halfLife" type="number" min="1" value={intent.halfLifeDays} onChange={(e) => setIntent({ ...intent, halfLifeDays: Number(e.target.value) || 1 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="satK">Saturation constant K</Label>
                      <Input id="satK" type="number" min="1" value={intent.saturationK} onChange={(e) => setIntent({ ...intent, saturationK: Number(e.target.value) || 1 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="capDay">Max events / type / day</Label>
                      <Input id="capDay" type="number" min="1" value={intent.maxPerTypePerDay} onChange={(e) => setIntent({ ...intent, maxPerTypePerDay: Number(e.target.value) || 1 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dedupe">Dedupe window (min)</Label>
                      <Input id="dedupe" type="number" min="0" value={intent.dedupeMinutes} onChange={(e) => setIntent({ ...intent, dedupeMinutes: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec7">Recency boost ≤7d</Label>
                      <Input id="rec7" type="number" value={intent.recencyBoost.within7d} onChange={(e) => setIntent({ ...intent, recencyBoost: { ...intent.recencyBoost, within7d: Number(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rec30">Recency boost ≤30d</Label>
                      <Input id="rec30" type="number" value={intent.recencyBoost.within30d} onChange={(e) => setIntent({ ...intent, recencyBoost: { ...intent.recencyBoost, within30d: Number(e.target.value) || 0 } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="inactDays">Inactivity after (days)</Label>
                      <Input id="inactDays" type="number" value={intent.inactivityPenalty.afterDays} onChange={(e) => setIntent({ ...intent, inactivityPenalty: { ...intent.inactivityPenalty, afterDays: Number(e.target.value) || 1 } })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="inactAmt">Inactivity penalty</Label>
                      <Input id="inactAmt" type="number" value={intent.inactivityPenalty.amount} onChange={(e) => setIntent({ ...intent, inactivityPenalty: { ...intent.inactivityPenalty, amount: Number(e.target.value) || 0 } })} />
                    </div>
                  </div>
                  {isAdmin ? (
                    <Button onClick={saveIntent} disabled={saving === "intent"}>
                      {saving === "intent" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save as new version
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Admin role required to change intent configuration.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Qualification */}
        <TabsContent value="qualification" className="mt-4 space-y-4">
          <Card className="p-0 gap-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Qualification thresholds & product info</CardTitle>
              <CardDescription>Used by the qualification engine and quoted to the Copilot as workspace context.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {thresholds && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="tFit">Sales-ready fit ≥</Label>
                      <Input id="tFit" type="number" value={thresholds.salesReadyFit} onChange={(e) => setThresholds({ ...thresholds, salesReadyFit: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tIntent">Sales-ready intent ≥</Label>
                      <Input id="tIntent" type="number" value={thresholds.salesReadyIntent} onChange={(e) => setThresholds({ ...thresholds, salesReadyIntent: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tProb">Sales-ready probability ≥</Label>
                      <Input id="tProb" type="number" min="0" max="1" step="0.05" value={thresholds.salesReadyProbability} onChange={(e) => setThresholds({ ...thresholds, salesReadyProbability: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tNurture">Nurture fit ≥</Label>
                      <Input id="tNurture" type="number" value={thresholds.nurtureFit} onChange={(e) => setThresholds({ ...thresholds, nurtureFit: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tWarm">Keep-warm fit ≥</Label>
                      <Input id="tWarm" type="number" value={thresholds.keepWarmFit} onChange={(e) => setThresholds({ ...thresholds, keepWarmFit: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tQuality">Data-quality floor</Label>
                      <Input id="tQuality" type="number" min="0" max="1" step="0.05" value={thresholds.lowQualityFloor} onChange={(e) => setThresholds({ ...thresholds, lowQualityFloor: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-1.5">
                    <Label htmlFor="productInfo">Product information (Copilot context)</Label>
                    <Textarea id="productInfo" rows={4} value={productInfo} onChange={(e) => setProductInfo(e.target.value)} placeholder="What your company sells, pricing structure, key messaging…" />
                  </div>
                  {isAdmin ? (
                    <Button onClick={saveQual} disabled={saving === "qual"}>
                      {saving === "qual" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Admin role required.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Knowledge */}
        <TabsContent value="knowledge" className="mt-4 space-y-4">
          <Card className="p-0 gap-0">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm">Knowledge base</CardTitle>
                <CardDescription>Playbooks, policies and product notes the Copilot retrieves with source attribution.</CardDescription>
              </div>
              {!isViewer && (
                <Button size="sm" onClick={() => setUploadOpen(true)} className="h-8">
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <EmptyState title="No documents yet" description="Upload your sales playbook and policies so the Copilot can quote them with sources." />
              ) : (
                <div className="space-y-2">
                  {docs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{d.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.kind.toLowerCase()} · {d.chunkCount} chunks · {(d.sizeBytes / 1024).toFixed(1)} KB · {fmtDateTime(d.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={d.status === "READY" ? "outline" : "secondary"} className={d.status === "READY" ? "text-emerald-600 dark:text-emerald-400" : ""}>
                          {d.status.toLowerCase()}
                        </Badge>
                        {!isViewer && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteDoc(d.id)} aria-label={`Delete ${d.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Memory */}
        <TabsContent value="memory" className="mt-4 space-y-4">
          <Card className="p-0 gap-0">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle className="text-sm">Conversational memory</CardTitle>
                <CardDescription>Business facts captured by the Copilot. Only approved items enter assistant context.</CardDescription>
              </div>
              {!isViewer && (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setMemoryOpen(true)}>
                  Add memory
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-96 lm-scroll">
                <div className="space-y-2">
                  {memories.length === 0 && <EmptyState title="No memories stored" />}
                  {memories.map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] uppercase">{m.scope}</Badge>
                          {m.lead && <span className="text-[11px] text-muted-foreground">{m.lead}</span>}
                          <span className="text-[10px] text-muted-foreground">· {m.source.toLowerCase()} · {fmtDateTime(m.updatedAt)}</span>
                        </div>
                        <p className="mt-1 text-sm">{m.value}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isAdmin ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              <Switch checked={m.approved} onCheckedChange={(v) => toggleMemory(m.id, v)} aria-label={`Approve memory: ${m.value.slice(0, 30)}`} />
                              <span className="text-[10px] text-muted-foreground">{m.approved ? "approved" : "pending"}</span>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMemory(m.id)} aria-label="Delete memory">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Badge variant={m.approved ? "outline" : "secondary"} className="text-[10px]">{m.approved ? "approved" : "pending"}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chatbot */}
        <TabsContent value="chatbot" className="mt-4 space-y-4">
          <Card className="p-0 gap-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Copilot configuration</CardTitle>
              <CardDescription>How the conversational assistant operates in this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Engine</p>
                  <p className="text-xs text-muted-foreground">
                    {session.llmMode === "live"
                      ? "An external LLM is connected via server-side SDK. Tool calls are validated by the application."
                      : "No external LLM configured. The local demo assistant answers a fixed set of analytical queries using the same validated tools and real workspace data."}
                  </p>
                </div>
                <Badge variant="outline" className={cn("shrink-0", session.llmMode === "live" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-amber-500/40 text-amber-600 dark:text-amber-400")}>
                  {session.llmMode === "live" ? "LIVE LLM" : "DEMO ASSISTANT"}
                </Badge>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Knowledge retrieval</p>
                  <p className="text-xs text-muted-foreground">{docs.length} indexed document(s), TF-IDF retrieval with source attribution.</p>
                </div>
                <Badge variant="outline">{docs.length} docs</Badge>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-3">
                <div>
                  <p className="text-sm font-medium">Approved memories</p>
                  <p className="text-xs text-muted-foreground">{memories.filter((m) => m.approved).length} item(s) currently in assistant context.</p>
                </div>
                <Badge variant="outline">{memories.filter((m) => m.approved).length}</Badge>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Sparkles className="h-3.5 w-3.5 text-emerald-500" /> Safety rules</p>
                <ul className="list-inside space-y-0.5">
                  <li>· Write actions (create lead, update lead, record outcome, store memory) require explicit user confirmation.</li>
                  <li>· Tool results and documents are treated as data, never as instructions (prompt-injection resistance).</li>
                  <li>· Every tool execution is workspace-scoped, permission-checked, timeout-bounded and audit-logged.</li>
                  <li>· The assistant never sends emails or performs external sales actions.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={async () => {
          const res = await api<{ documents: KnowledgeDoc[] }>("/api/knowledge");
          setDocs(res.documents);
        }}
      />

      {/* Memory dialog */}
      <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add workspace memory</DialogTitle>
            <DialogDescription>Stored as pending. An admin must approve it before it enters Copilot context.</DialogDescription>
          </DialogHeader>
          <MemoryForm onSubmit={addMemory} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MemoryForm({ onSubmit }: { onSubmit: (content: string, scope: string) => void }) {
  const [content, setContent] = useState("");
  const [scope, setScope] = useState("WORKSPACE");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="memScope">Scope</Label>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger id="memScope" aria-label="Scope"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="WORKSPACE">Workspace</SelectItem>
            <SelectItem value="USER">User preference</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="memContent">Fact to remember</Label>
        <Textarea id="memContent" value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Enterprise deals always involve a security review before contracting" />
      </div>
      <DialogFooter>
        <Button onClick={() => onSubmit(content, scope)} disabled={content.trim().length < 3}>Save memory</Button>
      </DialogFooter>
    </div>
  );
}

function UploadDialog({ open, onOpenChange, onUploaded }: { open: boolean; onOpenChange: (v: boolean) => void; onUploaded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("OTHER");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/knowledge", { method: "POST", body: { name, kind, text } });
      toast.success("Document indexed for retrieval");
      onOpenChange(false);
      setName("");
      setText("");
      await onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload knowledge document</DialogTitle>
          <DialogDescription>Text content is chunked and indexed (TF-IDF). CSV lead files belong in the Lead Universe import instead.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="docName">Name</Label>
              <Input id="docName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Objection handling guide" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="docKind">Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="docKind" aria-label="Kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLAYBOOK">Playbook</SelectItem>
                  <SelectItem value="POLICY">Policy</SelectItem>
                  <SelectItem value="PRODUCT">Product</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="docText">Content (paste text or markdown)</Label>
            <Textarea id="docText" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="lm-scroll" placeholder="Paste the document content…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="docFile">Or load a .txt / .md file</Label>
            <Input
              id="docFile"
              type="file"
              accept=".txt,.md,.csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const content = await file.text();
                setText(content);
                if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || name.trim().length === 0 || text.trim().length < 10}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Index document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
