-- CreateTable
CREATE TABLE "RoleProjectAccess" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "RoleProjectAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleProjectAccess_key_idx" ON "RoleProjectAccess"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RoleProjectAccess_roleId_key_key" ON "RoleProjectAccess"("roleId", "key");

-- AddForeignKey
ALTER TABLE "RoleProjectAccess" ADD CONSTRAINT "RoleProjectAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
