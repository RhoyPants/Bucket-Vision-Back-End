-- CreateTable
CREATE TABLE "ProgressLogAttachment" (
    "id" TEXT NOT NULL,
    "progressLogId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressLogAttachment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProgressLogAttachment" ADD CONSTRAINT "ProgressLogAttachment_progressLogId_fkey" FOREIGN KEY ("progressLogId") REFERENCES "ProgressLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
