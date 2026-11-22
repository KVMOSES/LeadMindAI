-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "employeeCount" INTEGER,
    "revenueBand" TEXT,
    "country" TEXT,
    "businessModel" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "dealValue" DOUBLE PRECISION,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT,
    "weight" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "version" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Qualification" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "overriddenById" TEXT,
    "overrideReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Qualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "signals" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "suggestedTiming" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "versionTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "params" TEXT NOT NULL,
    "features" TEXT NOT NULL,
    "artifacts" TEXT NOT NULL,
    "trainInfo" TEXT NOT NULL,
    "evalMetrics" TEXT NOT NULL,
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelEvaluation" (
    "id" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "confusion" TEXT NOT NULL,
    "calibration" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriftReport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "modelVersionId" TEXT,
    "status" TEXT NOT NULL,
    "psi" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriftReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "steps" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "conversationId" TEXT,
    "name" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "mode" TEXT NOT NULL DEFAULT 'LLM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolTraces" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "result" TEXT,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMemory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "leadId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CONVERSATION',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT,
    "error" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "recommendationId" TEXT,
    "kind" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "payload" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedOutcome" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "dealValue" DOUBLE PRECISION,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "isTrainingExcluded" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_idx" ON "Company"("workspaceId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_industry_idx" ON "Company"("workspaceId", "industry");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_idx" ON "Lead"("workspaceId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_createdAt_idx" ON "Lead"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_occurredAt_idx" ON "LeadEvent"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "LeadEvent_workspaceId_type_idx" ON "LeadEvent"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "IcpConfig_workspaceId_version_key" ON "IcpConfig"("workspaceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IntentConfig_workspaceId_version_key" ON "IntentConfig"("workspaceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_workspaceId_key_key" ON "Setting"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "Assessment_leadId_kind_createdAt_idx" ON "Assessment"("leadId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Assessment_workspaceId_kind_idx" ON "Assessment"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Qualification_leadId_isActive_idx" ON "Qualification"("leadId", "isActive");

-- CreateIndex
CREATE INDEX "Qualification_workspaceId_category_isActive_idx" ON "Qualification"("workspaceId", "category", "isActive");

-- CreateIndex
CREATE INDEX "Recommendation_leadId_status_idx" ON "Recommendation"("leadId", "status");

-- CreateIndex
CREATE INDEX "Recommendation_workspaceId_status_idx" ON "Recommendation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ModelVersion_workspaceId_isProduction_idx" ON "ModelVersion"("workspaceId", "isProduction");

-- CreateIndex
CREATE INDEX "ModelEvaluation_modelVersionId_idx" ON "ModelEvaluation"("modelVersionId");

-- CreateIndex
CREATE INDEX "DriftReport_workspaceId_createdAt_idx" ON "DriftReport"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_workspaceId_startedAt_idx" ON "AgentRun"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "ToolExecution_conversationId_idx" ON "ToolExecution"("conversationId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_updatedAt_idx" ON "Conversation"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingAction_conversationId_status_idx" ON "PendingAction"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ChatMemory_workspaceId_scope_approved_idx" ON "ChatMemory"("workspaceId", "scope", "approved");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_workspaceId_idx" ON "KnowledgeDocument"("workspaceId");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- CreateIndex
CREATE INDEX "Feedback_workspaceId_createdAt_idx" ON "Feedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "VerifiedOutcome_workspaceId_outcome_idx" ON "VerifiedOutcome"("workspaceId", "outcome");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpConfig" ADD CONSTRAINT "IcpConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentConfig" ADD CONSTRAINT "IntentConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Qualification" ADD CONSTRAINT "Qualification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelEvaluation" ADD CONSTRAINT "ModelEvaluation_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftReport" ADD CONSTRAINT "DriftReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftReport" ADD CONSTRAINT "DriftReport_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMemory" ADD CONSTRAINT "ChatMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMemory" ADD CONSTRAINT "ChatMemory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedOutcome" ADD CONSTRAINT "VerifiedOutcome_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

