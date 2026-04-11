-- CreateTable
CREATE TABLE "CourseArtifact" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storageUri" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/json',
    "sizeBytes" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseArtifact_courseId_idx" ON "CourseArtifact"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseArtifact_courseId_type_version_key" ON "CourseArtifact"("courseId", "type", "version");

-- AddForeignKey
ALTER TABLE "CourseArtifact" ADD CONSTRAINT "CourseArtifact_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
