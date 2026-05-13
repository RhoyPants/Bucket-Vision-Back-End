-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "regCode" TEXT NOT NULL,
    "regName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Province" (
    "id" TEXT NOT NULL,
    "provCode" TEXT NOT NULL,
    "provName" TEXT NOT NULL,
    "regCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "provCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barangay" (
    "id" TEXT NOT NULL,
    "brgyCode" TEXT NOT NULL,
    "brgyName" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barangay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_regCode_key" ON "Region"("regCode");

-- CreateIndex
CREATE INDEX "Region_regCode_idx" ON "Region"("regCode");

-- CreateIndex
CREATE UNIQUE INDEX "Province_provCode_key" ON "Province"("provCode");

-- CreateIndex
CREATE INDEX "Province_regCode_idx" ON "Province"("regCode");

-- CreateIndex
CREATE INDEX "Province_provCode_idx" ON "Province"("provCode");

-- CreateIndex
CREATE UNIQUE INDEX "City_cityCode_key" ON "City"("cityCode");

-- CreateIndex
CREATE INDEX "City_provCode_idx" ON "City"("provCode");

-- CreateIndex
CREATE INDEX "City_cityCode_idx" ON "City"("cityCode");

-- CreateIndex
CREATE UNIQUE INDEX "Barangay_brgyCode_key" ON "Barangay"("brgyCode");

-- CreateIndex
CREATE INDEX "Barangay_cityCode_idx" ON "Barangay"("cityCode");

-- CreateIndex
CREATE INDEX "Barangay_brgyCode_idx" ON "Barangay"("brgyCode");

-- AddForeignKey
ALTER TABLE "Province" ADD CONSTRAINT "Province_regCode_fkey" FOREIGN KEY ("regCode") REFERENCES "Region"("regCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_provCode_fkey" FOREIGN KEY ("provCode") REFERENCES "Province"("provCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barangay" ADD CONSTRAINT "Barangay_cityCode_fkey" FOREIGN KEY ("cityCode") REFERENCES "City"("cityCode") ON DELETE CASCADE ON UPDATE CASCADE;
