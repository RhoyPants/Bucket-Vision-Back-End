-- Add executionMode to ApprovalFlow
ALTER TABLE "ApprovalFlow" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'SEQUENTIAL';

-- Modify ApprovalStep to make role optional
ALTER TABLE "ApprovalStep" ALTER COLUMN "role" DROP NOT NULL;

-- Add useSpecificUsers flag to ApprovalStep
ALTER TABLE "ApprovalStep" ADD COLUMN "useSpecificUsers" BOOLEAN NOT NULL DEFAULT false;

-- Create ApprovalStepUser table (specific user assignments)
CREATE TABLE "ApprovalStepUser" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalStepUser_pkey" PRIMARY KEY ("id")
);

-- Create WorkSchedule table
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monday" BOOLEAN NOT NULL DEFAULT true,
    "tuesday" BOOLEAN NOT NULL DEFAULT true,
    "wednesday" BOOLEAN NOT NULL DEFAULT true,
    "thursday" BOOLEAN NOT NULL DEFAULT true,
    "friday" BOOLEAN NOT NULL DEFAULT true,
    "saturday" BOOLEAN NOT NULL DEFAULT false,
    "sunday" BOOLEAN NOT NULL DEFAULT false,
    "includeHolidays" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- Create Holiday table
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- Add workScheduleId to Project
ALTER TABLE "Project" ADD COLUMN "workScheduleId" TEXT;

-- Create indexes for ApprovalStepUser
CREATE UNIQUE INDEX "ApprovalStepUser_stepId_userId_key" ON "ApprovalStepUser"("stepId", "userId");
CREATE INDEX "ApprovalStepUser_stepId_idx" ON "ApprovalStepUser"("stepId");
CREATE INDEX "ApprovalStepUser_userId_idx" ON "ApprovalStepUser"("userId");

-- Create indexes for WorkSchedule
CREATE UNIQUE INDEX "WorkSchedule_name_key" ON "WorkSchedule"("name");
CREATE INDEX "WorkSchedule_isDefault_idx" ON "WorkSchedule"("isDefault");
CREATE INDEX "WorkSchedule_isActive_idx" ON "WorkSchedule"("isActive");

-- Create indexes for Holiday
CREATE UNIQUE INDEX "Holiday_scheduleId_date_key" ON "Holiday"("scheduleId", "date");
CREATE INDEX "Holiday_scheduleId_idx" ON "Holiday"("scheduleId");

-- Create index for Project workScheduleId
CREATE INDEX "Project_workScheduleId_idx" ON "Project"("workScheduleId");

-- Add foreign keys
ALTER TABLE "ApprovalStepUser" ADD CONSTRAINT "ApprovalStepUser_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ApprovalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalStepUser" ADD CONSTRAINT "ApprovalStepUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_workScheduleId_fkey" FOREIGN KEY ("workScheduleId") REFERENCES "WorkSchedule"("id") ON DELETE SET NULL;
