import jsPDF from "jspdf";

interface CertificateData {
    workerName: string;
    courseTitle: string;
    completionDate: string;
    organizationName: string;
    supervisorName?: string;
    certificateId: string;
    quizScore: number;
}

export function generateCertificate(data: CertificateData): jsPDF {
    const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Border
    doc.setLineWidth(2);
    doc.setDrawColor(79, 70, 229); // Indigo-600
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20);

    // Inner border
    doc.setLineWidth(0.5);
    doc.rect(15, 15, pageWidth - 30, pageHeight - 30);

    // Title
    doc.setFontSize(36);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(79, 70, 229);
    doc.text("Certificate of Completion", pageWidth / 2, 40, { align: "center" });

    // Subtitle
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("This certifies that", pageWidth / 2, 55, { align: "center" });

    // Worker Name
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59); // Slate-900
    doc.text(data.workerName, pageWidth / 2, 70, { align: "center" });

    // Course completion text
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("has successfully completed the training course", pageWidth / 2, 85, { align: "center" });

    // Course Title
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(data.courseTitle, pageWidth / 2, 100, { align: "center" });

    // Score
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(22, 163, 74); // Green-600
    doc.text(`Quiz Score: ${data.quizScore}%`, pageWidth / 2, 112, { align: "center" });

    // Completion Date
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Completed on ${data.completionDate}`, pageWidth / 2, 125, { align: "center" });

    // Organization
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(data.organizationName, pageWidth / 2, 140, { align: "center" });

    // CARF Compliance Statement
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    doc.text(
        "This training meets CARF accreditation standards for staff development",
        pageWidth / 2,
        155,
        { align: "center" }
    );

    // Signature line (if supervisor confirmed)
    if (data.supervisorName) {
        const signatureY = 175;
        doc.setLineWidth(0.5);
        doc.setDrawColor(150, 150, 150);
        doc.line(pageWidth / 2 - 40, signatureY, pageWidth / 2 + 40, signatureY);

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text(data.supervisorName, pageWidth / 2, signatureY + 5, { align: "center" });
        doc.text("Supervisor Signature", pageWidth / 2, signatureY + 10, { align: "center" });
    }

    // Certificate ID
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Certificate ID: ${data.certificateId}`, pageWidth / 2, pageHeight - 15, {
        align: "center",
    });

    return doc;
}

export function downloadCertificate(data: CertificateData) {
    const doc = generateCertificate(data);
    const fileName = `${data.workerName.replace(/\s+/g, "_")}_${data.courseTitle.replace(/\s+/g, "_")}_Certificate.pdf`;
    doc.save(fileName);
}

export async function uploadCertificateToStorage(
    doc: jsPDF,
    supabase: any,
    certificateId: string
): Promise<string | null> {
    try {
        const pdfBlob = doc.output("blob");
        const fileName = `${certificateId}.pdf`;

        const { data, error } = await supabase.storage
            .from("certificates")
            .upload(fileName, pdfBlob, {
                contentType: "application/pdf",
                upsert: true,
            });

        if (error) throw error;

        // Get public URL
        const { data: urlData } = supabase.storage
            .from("certificates")
            .getPublicUrl(fileName);

        return urlData.publicUrl;
    } catch (error) {
        console.error("Error uploading certificate:", error);
        return null;
    }
}
