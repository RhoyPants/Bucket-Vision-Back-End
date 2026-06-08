-- Create dashboard notes table
CREATE TABLE "DashboardNote" (
  "id" TEXT NOT NULL,
  "dashboardId" TEXT NOT NULL,
  "title" TEXT,
  "content" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DashboardNote_pkey" PRIMARY KEY ("id")
);

-- Create dashboard note items table
CREATE TABLE "DashboardNoteItem" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "isDone" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DashboardNoteItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "DashboardNote_dashboardId_idx" ON "DashboardNote"("dashboardId");
CREATE INDEX "DashboardNoteItem_noteId_idx" ON "DashboardNoteItem"("noteId");

-- Foreign keys
ALTER TABLE "DashboardNote"
ADD CONSTRAINT "DashboardNote_dashboardId_fkey"
FOREIGN KEY ("dashboardId") REFERENCES "PersonalDashboard"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardNoteItem"
ADD CONSTRAINT "DashboardNoteItem_noteId_fkey"
FOREIGN KEY ("noteId") REFERENCES "DashboardNote"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
