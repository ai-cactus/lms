# PHI Redactor — Full Documentation

## Overview

The PHI (Protected Health Information) Redactor is an AI-powered compliance scanner that detects PHI/PII in uploaded documents before they are processed into courses. It uses Google Vertex AI (Gemini) to analyze extracted document text and flag sensitive data such as names, SSNs, dates, phone numbers, emails, and addresses.

---

## Architecture

```
User uploads document
        │
        ▼
┌──────────────────┐
│  uploadDocument() │  (Server Action)
│  documents.ts     │
└────────┬─────────┘
         │
    ┌────▼────┐        ┌──────────────┐
    │ Extract │        │  saveFile()  │
    │  Text   │        │ (Storage)    │
    └────┬────┘        └──────────────┘
         │
    ┌────▼──────────┐
    │  scanText()   │  (PHI Scanner)
    │ phiScanner.ts │
    └────┬──────────┘
         │
    ┌────▼──────────┐
    │ callVertexAI()│  (Gemini API)
    │ ai-client.ts  │
    └────┬──────────┘
         │
         ▼
   ┌───────────────┐
   │  PHI Found?   │
   │               │
   ├── YES ────► Show PhiErrorModal (Course Wizard)
   │             OR warning badge (Document Hub)
   │             + Save PhiReport to DB
   │
   └── NO ─────► Proceed normally
                 + Save PhiReport (hasPHI=false)
```

---

## Database Schema (Prisma)

```prisma
model Document {
  id           String            @id @default(uuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id])
  filename     String
  originalName String
  mimeType     String
  size         Int
  versions     DocumentVersion[]
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
}

model DocumentVersion {
  id             String            @id @default(uuid())
  documentId     String
  document       Document          @relation(fields: [documentId], references: [id], onDelete: Cascade)
  version        Int               @default(1)
  storagePath    String
  hash           String            // SHA-256 for immutability
  content        String?           @db.Text // Extracted text
  phiReport      PhiReport?
  courseVersions CourseVersion[]
  mapping        MappingEvidence[]
  createdAt      DateTime          @default(now())
}

model PhiReport {
  id                String          @id @default(uuid())
  documentVersionId String          @unique
  documentVersion   DocumentVersion @relation(fields: [documentVersionId], references: [id], onDelete: Cascade)
  hasPHI            Boolean         @default(false)
  detectedEntities  Json?           // Array of PHIFinding objects
  scannedAt         DateTime        @default(now())
}
```

---

## Core Files

### 1. PHI Scanner — `src/lib/documents/phiScanner.ts`

The core scanning engine. Uses Vertex AI to analyze text for PHI/PII.

**Types:**

```typescript
export type PHIFinding = {
    type: 'DATE' | 'EMAIL' | 'PHONE' | 'SSN' | 'ZIP' | 'NAME' | 'ADDRESS' | 'OTHER';
    value: string;
    index: number;
    confidence?: number;
};

export type ScanResult = {
    hasPHI: boolean;
    findings: PHIFinding[];
};
```

**Full Code:**

```typescript
import { callVertexAI } from '@/lib/ai-client';

export type PHIFinding = {
    type: 'DATE' | 'EMAIL' | 'PHONE' | 'SSN' | 'ZIP' | 'NAME' | 'ADDRESS' | 'OTHER';
    value: string;
    index: number;
    confidence?: number;
};

export type ScanResult = {
    hasPHI: boolean;
    findings: PHIFinding[];
};

export async function scanText(text: string): Promise<ScanResult> {

    // Quick heuristic: If text is very short (< 50 chars), skip AI to save cost/time
    if (text.length < 50) return { hasPHI: false, findings: [] };

    // Truncate for analysis if needed
    // For MVP, taking first 15k characters is a reasonable trade-off.
    const contentToScan = text.slice(0, 15000);

    const prompt = `
        You are an expert compliance officer. Analyze the following text for Protected Health Information (PHI) and Personally Identifiable Information (PII).
        
        Look for:
        - Full Names of patients/clients (ignore public figures or generic names if context isn't medical/records)
        - Social Security Numbers (SSN)
        - Dates (birth dates, admission dates, discharge dates)
        - Phone numbers
        - Email addresses
        - Full addresses
        - Medical Record Numbers (MRN)
        
        TEXT TO ANALYZE:
        """
        ${contentToScan}
        """
        
        Return a JSON object with a boolean field "hasPHI" and an array "findings".
        Each finding should have: "type" (enum: NAME, SSN, DATE, PHONE, EMAIL, ADDRESS, OTHER), "value" (the exact text string), and "confidence" (0-1).
        Only include findings with high confidence (> 0.8) that appear to be real personal data, not generic placeholders.
    `;

    try {
        const aiResponse = await callVertexAI(prompt, { temperature: 0.1 });

        // JSON extraction
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn("PHI Scanner: No JSON found in response");
            return { hasPHI: false, findings: [] };
        }

        const data = JSON.parse(jsonMatch[0]);

        // Validate structure
        if (typeof data.hasPHI === 'boolean' && Array.isArray(data.findings)) {
            return {
                hasPHI: data.hasPHI,
                findings: data.findings.map((f: any) => ({
                    type: f.type || 'OTHER',
                    value: f.value || '',
                    index: 0,
                    confidence: f.confidence
                }))
            };
        }

        return { hasPHI: false, findings: [] };

    } catch (error) {
        console.error("PHI Scan Error:", error);
        // Fail open to avoid blocking user, but log for monitoring
        return { hasPHI: false, findings: [] };
    }
}
```

**Key Behaviors:**
- Skips scanning for text < 50 characters
- Scans only first 15,000 characters (cost/performance trade-off)
- Uses `temperature: 0.1` for deterministic results
- Only includes findings with > 0.8 confidence
- **Fails open** on error (returns `hasPHI: false`)

---

### 2. Document Upload Action — `src/app/actions/documents.ts`

Server action that orchestrates upload → extraction → PHI scan → DB save.

**Full Code:**

```typescript
'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { saveFile } from '@/lib/documents/uploadHandler';
import { calculateHash } from '@/lib/documents/versioning';
import { scanText } from '@/lib/documents/phiScanner';
import { extractTextFromFile } from '@/lib/file-parser';
import { revalidatePath } from 'next/cache';

export async function uploadDocument(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
        return { error: "Not authenticated or not in an organization" };
    }

    const file = formData.get('file') as File;
    if (!file) {
        return { error: "No file provided" };
    }

    // 1. Calculate Hash & Check Duplicates
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = await calculateHash(buffer);

    // 2. Extract Text
    let textContent = '';
    try {
        textContent = await extractTextFromFile(file);
        if (!textContent || textContent.trim().length === 0) {
            return { error: "Extraction Error: Document contains no extractable text." };
        }
    } catch (e: any) {
        console.error("Text extraction failed:", e);
        return { error: `Extraction Failed: ${e.message || "Could not read text."}` };
    }

    // 3. Scan for PHI
    let phiResult;
    try {
        phiResult = await scanText(textContent);
    } catch (e) {
        console.error("PHI Scan Error:", e);
        return { error: "Security Check Failed: Unable to scan document for PHI." };
    }

    if (phiResult.hasPHI) {
        // Currently: proceeds but flags the document
        // Could be changed to block upload entirely
    }

    try {
        // 4. Save File to storage
        const storagePath = await saveFile(file);

        await prisma.$transaction(async (tx) => {
            // Check if document already exists (same filename + user)
            const existingDoc = await tx.document.findFirst({
                where: { userId: session.user.id!, filename: file.name }
            });

            let docId = existingDoc?.id;
            let versionNumber = 1;

            if (existingDoc) {
                const latestVersion = await tx.documentVersion.findFirst({
                    where: { documentId: existingDoc.id },
                    orderBy: { version: 'desc' }
                });
                versionNumber = (latestVersion?.version || 0) + 1;
            } else {
                const newDoc = await tx.document.create({
                    data: {
                        userId: session.user.id!,
                        filename: file.name,
                        originalName: file.name,
                        mimeType: file.type,
                        size: file.size,
                    }
                });
                docId = newDoc.id;
            }

            // Create Version
            const version = await tx.documentVersion.create({
                data: {
                    documentId: docId!,
                    version: versionNumber,
                    storagePath,
                    hash,
                    content: textContent,
                }
            });

            // Create PHI Report
            await tx.phiReport.create({
                data: {
                    documentVersionId: version.id,
                    hasPHI: phiResult.hasPHI,
                    detectedEntities: phiResult.findings as any,
                }
            });
        });

        revalidatePath('/dashboard/documents');
        return { success: true, phiDetected: phiResult.hasPHI };

    } catch (e) {
        console.error(e);
        return { error: "Upload failed" };
    }
}

export async function getDocuments() {
    const session = await auth();
    if (!session?.user?.id) return [];

    const docs = await prisma.document.findMany({
        where: { userId: session.user.id },
        include: {
            versions: { orderBy: { version: 'desc' }, take: 1 }
        },
        orderBy: { updatedAt: 'desc' }
    });

    return docs;
}
```

**Key Behaviors:**
- Validates authentication and organization membership
- Extracts text using `extractTextFromFile()` (supports PDF, DOCX)
- Runs PHI scan on extracted text
- Saves file to storage, creates Document + DocumentVersion + PhiReport in a transaction
- Returns `{ success: true, phiDetected: boolean }` for the UI to react

---

### 3. PHI Error Modal — `src/components/dashboard/courses/PhiErrorModal.tsx`

Modal displayed when PHI is detected during course wizard document upload.

**Full Code:**

```tsx
import React from 'react';
import { Modal } from '@/components/ui';

interface PhiErrorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRetry: () => void;
    reason?: string;
}

export default function PhiErrorModal({ isOpen, onClose, onRetry, reason }: PhiErrorModalProps) {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="">
            <div style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', textAlign: 'center', padding: '24px 0'
            }}>
                {/* Icon: Document with magnifying glass */}
                <div style={{ position: 'relative', width: '120px', height: '120px', marginBottom: '24px' }}>
                    <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
                        <rect x="20" y="15" width="60" height="70" rx="4" fill="#F1F5F9" />
                        <rect x="20" y="15" width="60" height="70" rx="4" stroke="#E2E8F0" strokeWidth="2" />
                        <line x1="30" y1="30" x2="70" y2="30" stroke="#CBD5E0" strokeWidth="2" strokeLinecap="round" />
                        <line x1="30" y1="40" x2="70" y2="40" stroke="#CBD5E0" strokeWidth="2" strokeLinecap="round" />
                        <line x1="30" y1="50" x2="70" y2="50" stroke="#CBD5E0" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <div style={{ position: 'absolute', bottom: '0', left: '-10px', filter: 'drop-shadow(0px 10px 15px rgba(0,0,0,0.1))' }}>
                        <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
                            <circle cx="25" cy="25" r="20" fill="white" stroke="#4C6EF5" strokeWidth="4" />
                            <path d="M40 40L55 55" stroke="#4C6EF5" strokeWidth="6" strokeLinecap="round" />
                            <path d="M18 25H32" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                            <path d="M18 18H28" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                            <path d="M18 32H24" stroke="#4C6EF5" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                    </div>
                </div>

                <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#1A202C', marginBottom: '12px' }}>
                    PHI Detected!
                </h2>

                <p style={{ fontSize: '16px', color: '#4A5568', maxWidth: '400px', lineHeight: '1.5', marginBottom: '32px' }}>
                    Protected Health Information (PHI) has been detected in this document.
                    Please upload a valid document for analysis.
                    {reason && <span style={{ display: 'block', marginTop: '8px', fontSize: '14px', color: '#E53E3E' }}>Reason: {reason}</span>}
                </p>

                <button onClick={onRetry} style={{
                    background: '#4C6EF5', color: 'white', padding: '12px 32px',
                    borderRadius: '8px', fontWeight: 600, fontSize: '16px',
                    border: 'none', cursor: 'pointer', width: '100%', maxWidth: '300px',
                    transition: 'background 0.2s'
                }}>
                    Upload another document
                </button>
            </div>
        </Modal>
    );
}
```

---

### 4. Course Wizard Integration — `src/components/dashboard/courses/CourseWizard.tsx`

**Relevant state and handlers:**

```typescript
// PHI Scanning State (line 128-131)
const [isScanningPhi, setIsScanningPhi] = useState(false);
const [showPhiError, setShowPhiError] = useState(false);
const [phiReason, setPhiReason] = useState<string | undefined>(undefined);

// Retry handler (line 260-264)
const handleRetryUpload = () => {
    setShowPhiError(false);
    setPhiReason(undefined);
    setDocuments([]);
};

// In handleUpload (line 266-339):
// After uploading, checks if PHI was detected:
if (uploadResult.phiDetected) {
    setPhiReason("PHI Detected in document.");
    setShowPhiError(true);
    setIsAnalyzing(false);
    return; // Blocks proceeding
}

// Step 2 "Next" button disabled during PHI scan (line 411):
if (isAnalyzing || isScanningPhi) return true;

// PHI Error Modal rendered at bottom (line 509-515):
<PhiErrorModal
    isOpen={showPhiError}
    onClose={() => setShowPhiError(false)}
    onRetry={handleRetryUpload}
    reason={phiReason}
/>
```

---

### 5. Step 2 Documents UI — `src/components/dashboard/courses/steps/Step2Documents.tsx`

Displays a scanning animation while PHI scan is in progress:

```tsx
// Props (line 24):
isScanningPhi?: boolean;

// Scanning UI (line 185-199):
{isScanningPhi && (
    <div className={styles.scanningCard}>
        <div className={styles.scanningIcon}>
            <svg ...> ... </svg>
            <span className={styles.sparkle}>✨</span>
        </div>
        <div className={styles.scanningContent}>
            <h4>Scanning...</h4>
            <p>Ensuring document does not contain personal health information</p>
        </div>
    </div>
)}
```

---

### 6. Document Hub Upload Modal — `src/app/dashboard/(main)/documents/upload-modal.tsx`

Standalone document upload from the Documents page (outside the course wizard).

**Key PHI elements:**

```tsx
// PHI agreement checkbox (line 93-98):
<div className={styles.agreement}>
    <input type="checkbox" id="phi-agree" required />
    <label htmlFor="phi-agree">
        I verify this document contains no Protected Health Information (PHI).
    </label>
</div>

// PHI detection warning (line 103-108):
{state?.phiDetected && (
    <div className={styles.warning}>
        <strong>⚠️ PHI Detected</strong>
        <p>Our scanner found potential PHI in this document. It has been flagged for review.</p>
    </div>
)}

// Button text during scan (line 121-125):
{isPending ? (
    <span className={styles.scanningFlex}>
        <span className={styles.spinner}></span> Scanning for PHI...
    </span>
) : 'Upload'}
```

---

### 7. Document Viewer — `src/app/dashboard/(main)/documents/[id]/page.tsx`

Displays PHI badge on individual document pages:

```tsx
// PHI badge in document header (line 41):
{latest.phiReport?.hasPHI && <span className={styles.badgeWarning}>PHI Detected</span>}
```

---

### 8. AI Client Dependency — `src/lib/ai-client.ts`

The PHI scanner uses `callVertexAI()` from this centralized client:

- **Model**: `gemini-2.5-flash-lite` (default)
- **Retries**: 5 attempts with exponential backoff
- **Handles**: 429 rate limits and 5xx server errors
- **API Key**: `NEXT_PUBLIC_GEMINI_API_KEY` or `GEMINI_API_KEY`
- **Project**: `GOOGLE_PROJECT_ID` (default: `theraptly-lms`)

---

## Data Flow Summary

| Step | Component | Action |
|------|-----------|--------|
| 1 | User | Uploads PDF/DOCX |
| 2 | `uploadDocument()` | Extracts text via `extractTextFromFile()` |
| 3 | `scanText()` | Sends text to Vertex AI for PHI analysis |
| 4 | Vertex AI | Returns `{ hasPHI, findings[] }` |
| 5 | `uploadDocument()` | Saves Document, DocumentVersion, and PhiReport |
| 6a | Course Wizard | If PHI detected → shows `PhiErrorModal`, blocks proceeding |
| 6b | Document Hub | If PHI detected → shows warning badge |

---

## PHI Types Detected

| Type | Example |
|------|---------|
| `NAME` | Patient/client full names |
| `SSN` | Social Security Numbers |
| `DATE` | Birth dates, admission/discharge dates |
| `PHONE` | Phone numbers |
| `EMAIL` | Email addresses |
| `ADDRESS` | Full street addresses |
| `OTHER` | Medical Record Numbers (MRN), etc. |

---

## Current Limitations & Notes

1. **Fail-open policy**: If the AI scan fails (network error, API down), the system returns `hasPHI: false` and allows the upload. In production, this should be changed to fail-closed or require manual review.

2. **15k character limit**: Only the first 15,000 characters are scanned. Documents longer than this may have PHI in later sections that goes undetected.

3. **No redaction**: The system **detects** PHI but does not **redact** (remove/replace) it. Detected PHI is stored in the `PhiReport.detectedEntities` JSON field for review.

4. **Flagging vs blocking**: In the Course Wizard flow, PHI detection blocks the user from proceeding. In the Document Hub, the document is still saved but flagged with a warning badge.

5. **No index tracking**: The `index` field in `PHIFinding` always defaults to `0` since the AI doesn't provide character positions.

6. **Confidence threshold**: Only findings with > 0.8 confidence are included, reducing false positives.

---

## File Index

| File | Path | Purpose |
|------|------|---------|
| PHI Scanner | `src/lib/documents/phiScanner.ts` | Core AI scanning logic |
| AI Client | `src/lib/ai-client.ts` | Vertex AI API wrapper |
| Upload Action | `src/app/actions/documents.ts` | Server action: upload + scan + save |
| PHI Error Modal | `src/components/dashboard/courses/PhiErrorModal.tsx` | Error modal UI |
| Course Wizard | `src/components/dashboard/courses/CourseWizard.tsx` | Integration in course creation |
| Step 2 Documents | `src/components/dashboard/courses/steps/Step2Documents.tsx` | Doc upload step UI |
| Upload Modal | `src/app/dashboard/(main)/documents/upload-modal.tsx` | Standalone upload UI |
| Document Viewer | `src/app/dashboard/(main)/documents/[id]/page.tsx` | Document detail page |
| Documents List | `src/app/dashboard/(main)/documents/page.tsx` | Documents list page |
| Prisma Schema | `prisma/schema.prisma` | PhiReport, DocumentVersion models |
