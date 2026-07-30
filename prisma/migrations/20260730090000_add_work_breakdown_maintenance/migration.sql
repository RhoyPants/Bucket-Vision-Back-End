CREATE TABLE "ScopeMaintenance" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScopeMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskMaintenance" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubtaskMaintenance" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubtaskMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScopeMaintenanceTask" (
  "scopeMaintenanceId" TEXT NOT NULL,
  "taskMaintenanceId" TEXT NOT NULL,
  CONSTRAINT "ScopeMaintenanceTask_pkey" PRIMARY KEY ("scopeMaintenanceId", "taskMaintenanceId")
);

CREATE TABLE "TaskMaintenanceSubtask" (
  "taskMaintenanceId" TEXT NOT NULL,
  "subtaskMaintenanceId" TEXT NOT NULL,
  CONSTRAINT "TaskMaintenanceSubtask_pkey" PRIMARY KEY ("taskMaintenanceId", "subtaskMaintenanceId")
);

ALTER TABLE "Scope" ADD COLUMN "sourceType" TEXT, ADD COLUMN "scopeMaintenanceId" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceType" TEXT, ADD COLUMN "taskMaintenanceId" TEXT;
ALTER TABLE "Subtask" ADD COLUMN "sourceType" TEXT, ADD COLUMN "subtaskMaintenanceId" TEXT;

CREATE UNIQUE INDEX "ScopeMaintenance_code_key" ON "ScopeMaintenance"("code");
CREATE UNIQUE INDEX "TaskMaintenance_code_key" ON "TaskMaintenance"("code");
CREATE UNIQUE INDEX "SubtaskMaintenance_code_key" ON "SubtaskMaintenance"("code");
CREATE INDEX "ScopeMaintenance_isActive_idx" ON "ScopeMaintenance"("isActive");
CREATE INDEX "ScopeMaintenance_order_idx" ON "ScopeMaintenance"("order");
CREATE INDEX "TaskMaintenance_isActive_idx" ON "TaskMaintenance"("isActive");
CREATE INDEX "TaskMaintenance_order_idx" ON "TaskMaintenance"("order");
CREATE INDEX "SubtaskMaintenance_isActive_idx" ON "SubtaskMaintenance"("isActive");
CREATE INDEX "SubtaskMaintenance_order_idx" ON "SubtaskMaintenance"("order");
CREATE INDEX "ScopeMaintenanceTask_taskMaintenanceId_idx" ON "ScopeMaintenanceTask"("taskMaintenanceId");
CREATE INDEX "TaskMaintenanceSubtask_subtaskMaintenanceId_idx" ON "TaskMaintenanceSubtask"("subtaskMaintenanceId");
CREATE INDEX "Scope_scopeMaintenanceId_idx" ON "Scope"("scopeMaintenanceId");
CREATE INDEX "Task_taskMaintenanceId_idx" ON "Task"("taskMaintenanceId");
CREATE INDEX "Subtask_subtaskMaintenanceId_idx" ON "Subtask"("subtaskMaintenanceId");

ALTER TABLE "ScopeMaintenanceTask" ADD CONSTRAINT "ScopeMaintenanceTask_scopeMaintenanceId_fkey" FOREIGN KEY ("scopeMaintenanceId") REFERENCES "ScopeMaintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScopeMaintenanceTask" ADD CONSTRAINT "ScopeMaintenanceTask_taskMaintenanceId_fkey" FOREIGN KEY ("taskMaintenanceId") REFERENCES "TaskMaintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskMaintenanceSubtask" ADD CONSTRAINT "TaskMaintenanceSubtask_taskMaintenanceId_fkey" FOREIGN KEY ("taskMaintenanceId") REFERENCES "TaskMaintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskMaintenanceSubtask" ADD CONSTRAINT "TaskMaintenanceSubtask_subtaskMaintenanceId_fkey" FOREIGN KEY ("subtaskMaintenanceId") REFERENCES "SubtaskMaintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scope" ADD CONSTRAINT "Scope_scopeMaintenanceId_fkey" FOREIGN KEY ("scopeMaintenanceId") REFERENCES "ScopeMaintenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskMaintenanceId_fkey" FOREIGN KEY ("taskMaintenanceId") REFERENCES "TaskMaintenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_subtaskMaintenanceId_fkey" FOREIGN KEY ("subtaskMaintenanceId") REFERENCES "SubtaskMaintenance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
