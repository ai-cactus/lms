-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN     "facility_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "facility_scoped" BOOLEAN NOT NULL DEFAULT false;
