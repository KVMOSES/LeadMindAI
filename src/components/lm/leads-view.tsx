"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileUp,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { api, fmtMoney, fmtRelative, qualLabel, scoreColor } from "@/lib/api";
import type { LeadRowClient } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { SessionData } from "@/lib/store";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, QualBadge } from "@/components/lm/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;
const UNSET = "__unset";
const CSV_SAMPLE_HEADER = "Company,Contact,Industry,Employees,Revenue band,Country,Email,Title,Deal value";

const QUALIFICATIONS = ["SALES_READY", "NURTURE_TRACK", "KEEP_WARM", "MANUAL_REVIEW"] as const;

const SORT_FIELDS = [
  { value: "recent", label: "Recent" },
  { value: "fit", label: "Fit" },
  { value: "intent", label: "Intent" },
  { value: "probability", label: "Probability" },
  { value: "dealValue", label: "Deal value" },
  { value: "name", label: "Company" },
] as const;

const REVENUE_BANDS = ["<1M", "1M-10M", "10M-50M", "50M-100M", "100M+"] as const;

const BUSINESS_MODELS: { value: string; label: string }[] = [
  { value: "B2B_SAAS", label: "B2B SaaS" },
  { value: "ENTERPRISE", label: "Enterprise" },
  { value: "MARKETPLACE", label: "Marketplace" },
  { value: "B2C", label: "B2C" },
  { value: "AGENCY", label: "Agency" },
  { value: "OTHER", label: "Other" },
];

const SOURCES: { value: string; label: string }[] = [
  { value: "WEBSITE", label: "Website" },
  { value: "REFERRAL", label: "Referral" },
  { value: "OUTBOUND", label: "Outbound" },
  { value: "EVENT", label: "Event" },
  { value: "IMPORT", label: "Import" },
  { value: "MANUAL", label: "Manual" },
  { value: "PARTNER", label: "Partner" },
];

// ── Types ────────────────────────────────────────────────────────────────────

type SortField = (typeof SORT_FIELDS)[number]["value"];
type SortOrder = "asc" | "desc";

interface LeadsResponse {
  ok: boolean;
  items: LeadRowClient[];
  total: number;
  page: number;
  pageSize: number;
  facets: { industries: string[] };
}

interface LeadFormValues {
  companyName: string;
  contactName: string;
  industry: string;
  employeeCount: string;
  revenueBand: string;
  country: string;
  businessModel: string;
  email: string;
  title: string;
  phone: string;
  dealValue: string;
  source: string;
}

const EMPTY_FORM: LeadFormValues = {
  companyName: "",
  contactName: "",
  industry: "",
  employeeCount: "",
  revenueBand: "",
  country: "",
  businessModel: "",
  email: "",
  title: "",
  phone: "",
  dealValue: "",
  source: "",
};

interface LeadCreatePayload {
  companyName: string;
  contactName: string;
  industry?: string;
  employeeCount?: number;
  revenueBand?: string;
  country?: string;
  businessModel?: string;
  email?: string;
  title?: string;
  phone?: string;
  dealValue?: number;
  source?: string;
}

interface LeadPatchPayload {
  contactName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  dealValue?: number | null;
  industry?: string | null;
  employeeCount?: number | null;
  revenueBand?: string | null;
  country?: string | null;
  businessModel?: string | null;
}

interface ImportResult {
  ok: boolean;
  created: number;
  skipped: number;
  errors: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCreatePayload(form: LeadFormValues): LeadCreatePayload {
  const employees = parseNumber(form.employeeCount);
  const dealValue = parseNumber(form.dealValue);
  return {
    companyName: form.companyName.trim(),
    contactName: form.contactName.trim(),
    industry: form.industry.trim() || undefined,
    employeeCount: employees ?? undefined,
    revenueBand: form.revenueBand || undefined,
    country: form.country.trim() || undefined,
    businessModel: form.businessModel || undefined,
    email: form.email.trim() || undefined,
    title: form.title.trim() || undefined,
    phone: form.phone.trim() || undefined,
    dealValue: dealValue ?? undefined,
    source: form.source || undefined,
  };
}

function buildPatchPayload(form: LeadFormValues): LeadPatchPayload {
  const employees = parseNumber(form.employeeCount);
  const dealValue = parseNumber(form.dealValue);
  return {
    contactName: form.contactName.trim(),
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    title: form.title.trim() || null,
    dealValue,
    industry: form.industry.trim() || null,
    employeeCount: employees,
    revenueBand: form.revenueBand || null,
    country: form.country.trim() || null,
    businessModel: form.businessModel || null,
  };
}

// ── Small presentational pieces ──────────────────────────────────────────────

function ScoreCell({ value, percent = false }: { value: number | null; percent?: boolean }) {
  if (value === null) {
    return <span className="text-sm text-muted-foreground">{percent ? "n/a" : "—"}</span>;
  }
  const raw = percent ? Math.round(value * 100) : Math.round(value);
  const clamped = Math.min(100, Math.max(0, raw));
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-10 shrink-0 text-right text-sm font-medium tabular-nums", scoreColor(value))}>
        {percent ? `${raw}%` : raw}
      </span>
      <Progress value={clamped} className="h-1 w-16 [&>div]:bg-emerald-500" />
    </div>
  );
}

function SortButton({
  label,
  field,
  sort,
  order,
  onToggle,
}: {
  label: string;
  field: SortField;
  sort: SortField;
  order: SortOrder;
  onToggle: (field: SortField) => void;
}) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(field)}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded px-1 text-sm font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

// ── New / Edit lead dialog ───────────────────────────────────────────────────

function LeadFormDialog({
  open,
  onOpenChange,
  lead,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRowClient | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LeadFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const isEdit = lead !== null;

  useEffect(() => {
    if (!open) return;
    if (lead) {
      setForm({
        companyName: lead.companyName ?? "",
        contactName: lead.contactName ?? "",
        industry: lead.industry ?? "",
        employeeCount: lead.employeeCount === null ? "" : String(lead.employeeCount),
        revenueBand: lead.revenueBand ?? "",
        country: lead.country ?? "",
        businessModel: lead.businessModel ?? "",
        email: lead.email ?? "",
        title: lead.title ?? "",
        phone: lead.phone ?? "",
        dealValue: lead.dealValue === null ? "" : String(lead.dealValue),
        source: lead.source ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, lead]);

  function setField<K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.companyName.trim() || !form.contactName.trim()) {
      toast.error("Company name and contact name are required.");
      return;
    }
    setSaving(true);
    try {
      if (lead) {
        await api<{ ok: boolean; detail?: string }>(`/api/leads/${lead.id}`, {
          method: "PATCH",
          body: buildPatchPayload(form),
        });
        toast.success(`Lead updated — ${form.companyName.trim()}`);
      } else {
        await api<{ ok: boolean; leadId?: string }>("/api/leads", {
          method: "POST",
          body: buildCreatePayload(form),
        });
        toast.success(`Lead created — ${form.companyName.trim()}`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit lead" : "New lead"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Update the details for ${lead?.companyName ?? "this lead"}.`
              : "Add a lead to the workspace. Company and contact names are required."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate autoComplete="off">
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-company">Company name *</Label>
            <Input
              id="lm-lead-company"
              value={form.companyName}
              onChange={(e) => setField("companyName", e.target.value)}
              disabled={isEdit}
              required
              aria-required="true"
            />
            {isEdit && <p className="text-xs text-muted-foreground">Company name cannot be changed after creation.</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-contact">Contact name *</Label>
            <Input
              id="lm-lead-contact"
              value={form.contactName}
              onChange={(e) => setField("contactName", e.target.value)}
              required
              aria-required="true"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-industry">Industry</Label>
            <Input
              id="lm-lead-industry"
              value={form.industry}
              onChange={(e) => setField("industry", e.target.value)}
              placeholder="e.g. SaaS, FinTech, Healthcare IT"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-employees">Employees</Label>
            <Input
              id="lm-lead-employees"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.employeeCount}
              onChange={(e) => setField("employeeCount", e.target.value)}
              placeholder="e.g. 250"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-revenue">Revenue band</Label>
            <Select
              value={form.revenueBand || UNSET}
              onValueChange={(v) => setField("revenueBand", v === UNSET ? "" : v)}
            >
              <SelectTrigger id="lm-lead-revenue" aria-label="Revenue band">
                <SelectValue placeholder="Select revenue band" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {REVENUE_BANDS.map((band) => (
                  <SelectItem key={band} value={band}>
                    {band}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-country">Country</Label>
            <Input
              id="lm-lead-country"
              value={form.country}
              onChange={(e) => setField("country", e.target.value)}
              placeholder="e.g. United States"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-model">Business model</Label>
            <Select
              value={form.businessModel || UNSET}
              onValueChange={(v) => setField("businessModel", v === UNSET ? "" : v)}
            >
              <SelectTrigger id="lm-lead-model" aria-label="Business model">
                <SelectValue placeholder="Select business model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {BUSINESS_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-email">Email</Label>
            <Input
              id="lm-lead-email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="name@company.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-title">Title</Label>
            <Input
              id="lm-lead-title"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="e.g. VP of Engineering"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-phone">Phone</Label>
            <Input
              id="lm-lead-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="e.g. +1 555 000 1234"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-deal">Deal value</Label>
            <Input
              id="lm-lead-deal"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={form.dealValue}
              onChange={(e) => setField("dealValue", e.target.value)}
              placeholder="e.g. 25000"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lm-lead-source">Source</Label>
            <Select value={form.source || UNSET} onValueChange={(v) => setField("source", v === UNSET ? "" : v)}>
              <SelectTrigger id="lm-lead-source" aria-label="Source">
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                {SOURCES.map((source) => (
                  <SelectItem key={source.value} value={source.value}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="mt-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Save changes" : "Create lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Import dialog ────────────────────────────────────────────────────────────

function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(typeof reader.result === "string" ? reader.result : "");
      toast.success(`Loaded ${file.name}`);
    };
    reader.onerror = () => toast.error("Could not read the selected file.");
    reader.readAsText(file);
    event.target.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csv.trim()) {
      toast.error("Paste CSV content or choose a file first.");
      return;
    }
    setImporting(true);
    try {
      const res = await api<ImportResult>("/api/leads/import", { method: "POST", body: { csv } });
      setResult(res);
      if (res.created > 0) {
        toast.success(
          `Imported ${res.created} lead${res.created === 1 ? "" : "s"}${res.skipped ? `, skipped ${res.skipped}` : ""}.`,
        );
      } else {
        toast.warning(`No leads imported${res.skipped ? ` — ${res.skipped} skipped` : ""}.`);
      }
      if (res.errors && res.errors.length > 0) {
        toast.warning(`${res.errors.length} row${res.errors.length === 1 ? "" : "s"} reported errors — see details.`);
      }
      onImported();
      if (res.created > 0) setCsv("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Paste CSV content or upload a file. One lead per row with a header row first.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="lm-import-csv">CSV content</Label>
            <Textarea
              id="lm-import-csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder={CSV_SAMPLE_HEADER}
            />
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Expected columns: <span className="font-mono">{CSV_SAMPLE_HEADER}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              id="lm-import-file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              aria-label="Choose CSV file"
              onChange={handleFile}
            />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <FileUp className="size-4" aria-hidden="true" />
              Choose file
            </Button>
            {result && (
              <p className="text-xs text-muted-foreground">
                Created {result.created} · Skipped {result.skipped}
              </p>
            )}
          </div>
          {result && result.errors.length > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>{result.errors.length} row(s) were skipped</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
              Cancel
            </Button>
            <Button type="submit" disabled={importing || !csv.trim()}>
              {importing ? "Importing..." : "Import leads"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function LeadsView({ session }: { session: SessionData }) {
  const navigate = useAppStore((s) => s.navigate);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [industry, setIndustry] = useState("ALL");
  const [qualification, setQualification] = useState("ALL");
  const [sort, setSort] = useState<SortField>("recent");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<LeadRowClient[]>([]);
  const [total, setTotal] = useState(0);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editLead, setEditLead] = useState<LeadRowClient | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const reqIdRef = useRef(0);

  // Debounce free-text search (350ms, no external deps).
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Any filter or sort change resets pagination.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, industry, qualification, sort, order]);

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("query", searchQuery.trim());
    if (industry !== "ALL") params.set("industry", industry);
    if (qualification !== "ALL") params.set("qualification", qualification);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    try {
      const res = await api<LeadsResponse>(`/api/leads?${params.toString()}`);
      if (reqId !== reqIdRef.current) return;
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
      if (res.facets && Array.isArray(res.facets.industries)) setIndustries(res.facets.industries);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load leads.");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [searchQuery, industry, qualification, sort, order, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (field === sort) {
        setOrder((prev) => (prev === "desc" ? "asc" : "desc"));
      } else {
        setSort(field);
        setOrder("desc");
      }
    },
    [sort],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead Universe"
        description="Search, filter and manage every lead in the workspace"
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden="true" />
              Import CSV
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/leads/export">
                <Download className="size-4" aria-hidden="true" />
                Export
              </a>
            </Button>
            <Button
              onClick={() => {
                setEditLead(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              New lead
            </Button>
          </>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Lead filters">
        <div className="relative w-full sm:w-64">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="lm-lead-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search company, contact, email..."
            className="pl-8"
            aria-label="Search leads"
          />
        </div>
        <Select
          value={industry}
          onValueChange={(v) => {
            setIndustry(v);
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by industry">
            <SelectValue placeholder="All industries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All industries</SelectItem>
            {industries.map((ind) => (
              <SelectItem key={ind} value={ind}>
                {ind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={qualification}
          onValueChange={(v) => {
            setQualification(v);
          }}
        >
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
        <Select
          value={sort}
          onValueChange={(v) => {
            setSort(v as SortField);
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Sort leads">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORT_FIELDS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="gap-0 overflow-hidden p-0">
        <CardContent className="p-0">
          {error && (
            <div className="p-4">
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertTitle>Failed to load leads</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{error}</span>
                  <Button variant="outline" onClick={() => void load()}>
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          <div className="overflow-x-auto" aria-busy={loading}>
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Company</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>
                    <SortButton label="Fit" field="fit" sort={sort} order={order} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead>
                    <SortButton label="Intent" field="intent" sort={sort} order={order} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead>
                    <SortButton label="Conv. %" field="probability" sort={sort} order={order} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead>Qualification</TableHead>
                  <TableHead>
                    <SortButton label="Deal value" field="dealValue" sort={sort} order={order} onToggle={toggleSort} />
                  </TableHead>
                  <TableHead>Last event</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                      <TableCell colSpan={9} className="py-2">
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9}>
                      <EmptyState
                        title="No leads match your filters"
                        description="Try adjusting the search or clearing a filter, or add a new lead."
                        icon={<Users className="size-8" aria-hidden="true" />}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((lead) => (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer"
                      onClick={() => navigate("lead", { leadId: lead.id })}
                    >
                      <TableCell>
                        <p className="font-medium">{lead.companyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {lead.contactName}
                          {lead.title ? ` · ${lead.title}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{lead.industry ?? "—"}</TableCell>
                      <TableCell>
                        <ScoreCell value={lead.fit} />
                      </TableCell>
                      <TableCell>
                        <ScoreCell value={lead.intent} />
                      </TableCell>
                      <TableCell>
                        <ScoreCell value={lead.probability} percent />
                      </TableCell>
                      <TableCell>
                        <QualBadge
                          category={lead.qualification?.category ?? null}
                          source={lead.qualification?.source}
                        />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{fmtMoney(lead.dealValue)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtRelative(lead.lastEventAt)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${lead.companyName}`}
                            >
                              <MoreHorizontal className="size-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onSelect={() => navigate("lead", { leadId: lead.id })}>
                              <Eye className="size-4" aria-hidden="true" />
                              View profile
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditLead(lead);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => navigate("copilot", { leadContextId: lead.id })}>
                              <Sparkles className="size-4" aria-hidden="true" />
                              Ask Copilot
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? "lead" : "leads"} · page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Prev
              </Button>
              <Button
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <LeadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lead={editLead}
        onSaved={() => void load()}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => void load()} />
    </div>
  );
}
