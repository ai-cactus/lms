-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "slideContent" TEXT;

-- CreateTable
CREATE TABLE "CourseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardManual" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "processedAt" TIMESTAMP(3),
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandardManual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualChunk" (
    "id" TEXT NOT NULL,
    "manualId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualChunkCategory" (
    "chunkId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ManualChunkCategory_pkey" PRIMARY KEY ("chunkId","categoryId")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "pdfStoragePath" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategory_slug_key" ON "CourseCategory"("slug");

-- CreateIndex
CREATE INDEX "CourseCategory_organizationId_idx" ON "CourseCategory"("organizationId");

-- CreateIndex
CREATE INDEX "CourseCategory_isSystem_idx" ON "CourseCategory"("isSystem");

-- CreateIndex
CREATE INDEX "StandardManual_isActive_idx" ON "StandardManual"("isActive");

-- CreateIndex
CREATE INDEX "ManualChunk_manualId_idx" ON "ManualChunk"("manualId");

-- CreateIndex
CREATE INDEX "ManualChunk_manualId_chunkIndex_idx" ON "ManualChunk"("manualId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_enrollmentId_key" ON "Certificate"("enrollmentId");

-- CreateIndex
CREATE INDEX "Certificate_userId_idx" ON "Certificate"("userId");

-- CreateIndex
CREATE INDEX "Certificate_courseId_idx" ON "Certificate"("courseId");

-- CreateIndex
CREATE INDEX "Course_categoryId_idx" ON "Course"("categoryId");

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCategory" ADD CONSTRAINT "CourseCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChunk" ADD CONSTRAINT "ManualChunk_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "StandardManual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChunkCategory" ADD CONSTRAINT "ManualChunkCategory_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ManualChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChunkCategory" ADD CONSTRAINT "ManualChunkCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
