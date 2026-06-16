-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "previewMediaStatus" "MediaStatus";

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "mediaStatus" "MediaStatus" NOT NULL DEFAULT 'ready';
