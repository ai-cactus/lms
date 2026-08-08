-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "preview_video_encoding_version" INTEGER;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "video_encoding_version" INTEGER;
