# LeadMind AI — Conversational Sales Intelligence Platform

LeadMind AI combines **predictive analytics, behavioural intelligence, machine learning and an AI copilot** so sales teams can understand and convert leads without living inside dashboards. It ships with two interfaces:

1. **Traditional intelligence** — dashboard, lead management, scoring, model monitoring, explainability.
2. **Conversational intelligence** — **LeadMind Copilot**, a first-class assistant that investigates *real workspace data* through validated application tools and answers in natural language.

The chatbot is **not** a decorative wrapper around an LLM: it plans, calls the same engines the UI uses, cites what it retrieved, asks for confirmation before changing business data, and falls back to a clearly-labelled deterministic demo assistant when no external LLM is configured.

---

## Quick start (local)

```bash
bun install                 # install dependencies
bun run db:generate
bun run db:migrate          # create a development migration (requires PostgreSQL)
bun run dev                 # start Next.js on http://localhost:3000
```

Open the app, click **“Enter demo mode”**. The first entry seeds the full demo environment (idempotent, ~5s): 26 companies/leads with realistic engagement histories, ICP + intent configuration, a 3-document knowledge base, verified outcomes, memories, sample conversations, and three trained conversion models.

**Demo credentials:** `demo@leadmind.ai` / `demo1234` (ADMIN role of the demo workspace).

The app auto-detects whether an external LLM is available (`z-ai-web-dev-sdk`, server-side only). Status is shown in the sidebar (“Copilot engine”) and on every chat header.

---

## Architecture

```
src/
  app/
    page.tsx                       # single-route SPA shell (login + app views)
    api/                           # ~30 REST route handlers
      auth/{login,demo,logout,me}  # scrypt sessions in httpOnly cookies
      leads/…                      # CRUD, events, assess, override, outcome, feedback, CSV import/export
      analytics/{dashboard,trends}
      recommendations/[id]         # status transitions
      models/[id]/activate         # train / list / detail / promote
      monitoring/{quality,drift,agent-runs}
      chat/conversations/…         # CRUD + STREAMING SSE message endpoint
      chat/pending/[id]            # confirm / cancel write actions
      knowledge/[id]               # RAG document management
      workspace/{icp,intent,settings,memory}
      feedback
  lib/
    engines/icp.ts                 # Customer Fit engine (0-100, weighted ICP dimensions)
    engines/intent.ts              # Buying Intent engine (weights, decay, dedupe, caps)
    engines/qualification.ts       # 4-category qualification with explicit reasons
    engines/nba.ts                 # next-best-action rules + learned priors
    engines/pipeline.ts            # deterministic analytical agent (parallel steps,
                                   #   content-hash caching, retries, AgentRun traces)
    ml/                            # from-scratch TS ML stack:
                                   #   logistic regression, CART/random forest, gradient boosting,
                                   #   ROC/PR-AUC, calibration, PSI drift, dataset builder
    chat/tools.ts                  # 21 validated workspace tools (zod, RBAC, timeouts, audit)
    chat/copilot.ts                # conversational controller: JSON tool protocol,
                                   #   real token streaming, bounded iterations, fallback
    chat/demo.ts                   # deterministic demo assistant (real tool executions)
    chat/pending.ts                # confirmation-gated write executor
    rag.ts                         # chunking + TF-IDF retrieval with source attribution
    auth.ts  audit.ts  rate-limit.ts  cache.ts  csv.ts  analytics.ts
prisma/schema.prisma               # 22 models, workspace-scoped, indexed
```

**Two orchestration paths, one source of truth.** The analytical controller (`engines/pipeline.ts`) runs fit → intent (parallel) → prediction → qualification → recommendations with content-hash caching and persisted traces. The conversational controller (`chat/copilot.ts`) selects and calls validated tools; it never reimplements scoring.

## The Copilot tool registry (21 tools)

Read: `search_leads`, `get_lead_details`, `compare_leads`, `get_lead_timeline`, `get_assessment`, `explain_lead_scoring`, `get_dashboard_metrics`, `get_engagement_trends`, `get_recommendations`, `get_model_status`, `get_drift_report`, `get_data_quality_report`, `search_knowledge`, `get_lead_memory`, `get_workspace_config`.
Write-reversible: `update_recommendation_status`, `record_feedback`.
Write-confirm (user must click Confirm in the UI): `create_lead`, `update_lead`, `record_outcome`, `remember_information`.

Every tool: zod-validated arguments, workspace scoping, role checks (VIEWER is read-only), 10s timeout, `ToolExecution` logging, audit trail for mutations.

## Intelligence engines

- **Customer fit** — configurable ICP (industries, size, revenue, geo, business model, deal value, completeness weights). Versions on save; explanations list positive/negative/missing factors.
- **Buying intent** — configurable event weights (incl. negative signals), exponential time decay (half-life), per-type/day caps + dedupe window for reproducibility, recency boost, inactivity penalty. **Missing events are reported as unknown, never as zero interest.**
- **Qualification** — Sales Ready / Nurture Track / Keep Warm / Manual Review from fit, intent, prediction availability and data quality. Every classification records its reasons; authorized manual overrides require a reason and are audit-logged.
- **Next best action** — evidence-based rules (unanswered demo requests, pricing evaluation, fit/intent mismatch, re-engagement, data gaps…) that deduplicate against pending actions and learn from past outcomes/feedback.

## Machine learning (honest by design)

- Dataset = **clearly-labelled synthetic majority (560 rows, seeded, reproducible) + real `VerifiedOutcome` rows** (currently 8). The Model Intelligence page shows an amber provenance banner; metrics are never presented as real-world performance.
- Three algorithm families trained from scratch in TypeScript: **logistic regression** (standardized, L2), **random forest** (bagged CART, sqrt feature subsampling), **gradient boosting** (logistic loss, depth-3 trees).
- Leakage-safe **stratified 60/20/20 split**; hyperparameters selected on validation only; **final metrics on the untouched test set**; PR-AUC selects the production model; previous production is archived.
- Per-prediction **feature contributions** (exact analytic for LR, one-at-a-time marginal for tree ensembles — labelled as SHAP-inspired), reliability notes from **calibration bins**, missing-feature warnings with train-mean imputation.
- **Drift monitoring** via per-feature PSI against training reference deciles (STABLE/WARNING/ALERT), recomputed on demand.
- Latest verified test metrics in this environment (demo dataset): ROC-AUC 0.91, PR-AUC 0.85, F1 0.80 (LR v1); retraining through the UI produced a GBM v2 generation (ROC-AUC 0.905) with automatic promotion/archival.

## Streaming chat protocol

`POST /api/chat/conversations/[id]/messages` returns an SSE stream with events: `status` (thinking/running tool X), `tools` (execution traces), `delta` (tokens), `pending_action` (confirmation card), `done`/`error`. The LLM loop uses a strict JSON tool protocol with bounded iterations (6), provider-level fallback to the demo assistant (circuit breaker), and token accounting. Demo-mode answers are streamed in labelled chunks with a visible demo banner.

## Memory & RAG

- **Short-term**: last messages + active lead context per conversation.
- **Lead context**: identity, assessments, events, recommendations, outcomes.
- **Workspace knowledge**: ICP config, thresholds, product info, approved memories.
- **Long-term memories**: captured via `remember_information` (confirmation-gated) or Settings; **approved by an admin before entering assistant context**; manageable in Settings → Memory.
- **RAG**: documents (pasted text / .md / .txt upload) are chunked and TF-IDF-indexed per workspace; retrieval returns excerpts **with source names**; knowledge answers quote the source document.

## Security

Session auth (scrypt + httpOnly cookies), role model (ADMIN/MEMBER/VIEWER), workspace isolation on every query, zod input validation everywhere, per-IP/user rate limits (auth, demo entry, chat, training), audit logs, safe file handling (size/type bounds), prompt-injection resistance (tool results and documents are data, never instructions), no provider keys in the browser, and confirmation gating for business-data mutations.

## Verified end-to-end journey (executed in-browser)

demo entry → dashboard renders live metrics → Lead Universe search/filter/sort → lead profile with explainability → assessment run (cache visible in trace) → Copilot “Why was this lead classified as Sales Ready?” (resolved the active lead, called `get_assessment`, quoted real scores + approved memory) → “Compare this lead with other high-fit leads” (multi-tool, real comparison table) → knowledge question (source-attributed answer) → create-lead via chat **with confirmation card** → lead + auto-assessment persisted → conversation reload persistence (hash deep-link) → model training through the UI (3 algorithms, promotion + archival) → monitoring (PSI, data quality, agent-run traces) → Action Center accept/dismiss → outcome recording available on profiles → CSV export → dark mode → mobile layout with sticky footer. Dev log clean; `tsc --noEmit` and `eslint` pass.

## Known limitations

- Python/FastAPI ML microservice (XGBoost/SHAP as specified in the reference stack) is **not** available in this sandbox; the TypeScript pipeline above provides the same workflow (3 algorithm families, calibration, PSI) with honest labelling. Swapping in XGBoost/SHAP later only touches `src/lib/ml`.
- SQLite (per sandbox constraint) instead of PostgreSQL; Prisma keeps the schema portable.
- Streaming of the **final** answer is token-level; intermediate tool iterations are status events. If the LLM provider is unreachable, the demo assistant streams in labelled chunks (typing simulation).
- Drift needs ≥20 recent predictions against the current model to populate; right after a training it reports “needs scored leads” until assessments run (self-heals, or recompute after 10 min cache TTL).
- No automated test suites (sandbox rule: no test code); quality gates used instead: strict `tsc`, ESLint, and the executed browser journey above.
- Emails/external sales actions are intentionally never sent by the assistant.

## Vercel and Neon deployment

1. Copy `.env.example` to `.env` for local work. In Neon, use the pooled connection string for `DATABASE_URL` and the unpooled connection string for `DIRECT_URL`; keep both values private. Set both variables in Vercel for every environment that needs the app. No database URL is exposed to client bundles.
2. Install and generate Prisma with `bun install --frozen-lockfile` and `bun run db:generate`. Vercel's build runs `prisma generate` before `next build`; build errors are not ignored.
3. Apply checked-in database migrations with `bun run db:migrate:deploy` before routing traffic. Do not use schema-push/reset commands on production. If Neon already contains tables but has no Prisma migration history, inspect that schema first and baseline it only after confirming it matches the migration.
4. To retain the existing SQLite data, first deploy the PostgreSQL schema, then preview the source with `bun scripts/migrate-sqlite-to-postgres.mjs --dry-run`. Run `bun run db:migrate:sqlite` only after confirming the Neon target. The transfer reads `db/custom.db` (or `SQLITE_DATA_PATH`) read-only, preflights ID collisions, copies every Prisma model in dependency order in one PostgreSQL transaction, and aborts rather than overwriting conflicting rows. Keep the SQLite file as your backup.
5. In Vercel, use the standard Next.js build command (`bun run build`). The application uses the Vercel-compatible Next.js output; start the app with `bun run start` only for local production checks. Configure any optional AI provider credentials as server-only environment variables.

The database migration and the one-time SQLite data transfer are separate operations. Do not run the transfer until the PostgreSQL schema exists, and do not delete the original SQLite file after deployment.
