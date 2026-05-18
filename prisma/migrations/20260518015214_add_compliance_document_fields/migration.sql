-- DropIndex
DROP INDEX "manual_chunk_embedding_cosine_idx";

-- AlterTable
ALTER TABLE "ManualChunk" DROP COLUMN "embedding";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "complianceDocumentName" TEXT,
ADD COLUMN     "complianceDocumentUrl" TEXT;

