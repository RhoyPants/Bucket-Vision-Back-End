-- AlterTable
ALTER TABLE "KpiThresholdRule" ADD COLUMN     "dateOperator" "KpiValueOperator",
ADD COLUMN     "dateValue1" TIMESTAMP(3),
ADD COLUMN     "dateValue2" TIMESTAMP(3);
