-- CreateTable
CREATE TABLE "DiscussionRead" (
    "userId" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionRead_pkey" PRIMARY KEY ("userId","discussionId")
);

-- CreateTable
CREATE TABLE "DiscussionMention" (
    "id" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "replyId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscussionRead_discussionId_idx" ON "DiscussionRead"("discussionId");

-- CreateIndex
CREATE INDEX "DiscussionMention_userId_createdAt_idx" ON "DiscussionMention"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscussionMention_discussionId_idx" ON "DiscussionMention"("discussionId");

-- AddForeignKey
ALTER TABLE "DiscussionRead" ADD CONSTRAINT "DiscussionRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionRead" ADD CONSTRAINT "DiscussionRead_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMention" ADD CONSTRAINT "DiscussionMention_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "Discussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMention" ADD CONSTRAINT "DiscussionMention_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "DiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMention" ADD CONSTRAINT "DiscussionMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

