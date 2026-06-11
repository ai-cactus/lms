-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('text', 'video');

-- AlterTable: Course — add type, isGlobal
ALTER TABLE "Course" ADD COLUMN "type" "CourseType" NOT NULL DEFAULT 'text';
ALTER TABLE "Course" ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Lesson — add video fields
ALTER TABLE "Lesson" ADD COLUMN "videoProvider" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "videoStorageUri" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "videoDurationSeconds" INTEGER;

-- AlterTable: Enrollment — add video resume position
ALTER TABLE "Enrollment" ADD COLUMN "videoPositionSeconds" INTEGER;

-- CreateTable: OrgCourseOffering
CREATE TABLE "OrgCourseOffering" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "addedByAdminId" TEXT NOT NULL,
    "customTitle" TEXT,
    "customDescription" TEXT,
    "customIntro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgCourseOffering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Course_type_idx" ON "Course"("type");

-- CreateIndex
CREATE INDEX "Course_isGlobal_idx" ON "Course"("isGlobal");

-- CreateIndex
CREATE UNIQUE INDEX "OrgCourseOffering_organizationId_courseId_key" ON "OrgCourseOffering"("organizationId", "courseId");

-- CreateIndex
CREATE INDEX "OrgCourseOffering_organizationId_idx" ON "OrgCourseOffering"("organizationId");

-- CreateIndex
CREATE INDEX "OrgCourseOffering_courseId_idx" ON "OrgCourseOffering"("courseId");

-- AddForeignKey
ALTER TABLE "OrgCourseOffering" ADD CONSTRAINT "OrgCourseOffering_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgCourseOffering" ADD CONSTRAINT "OrgCourseOffering_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
