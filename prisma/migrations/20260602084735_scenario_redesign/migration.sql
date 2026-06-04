-- AlterTable
ALTER TABLE "Rate" ADD COLUMN     "profileId" TEXT,
ADD COLUMN     "profileName" TEXT;

-- AlterTable
ALTER TABLE "Zone" ALTER COLUMN "zipCodes" SET DEFAULT '';
