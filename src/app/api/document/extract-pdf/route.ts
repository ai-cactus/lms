import { NextRequest, NextResponse } from "next/server";
// @ts-ignore
import PDFParser from "pdf2json";

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        // Check if it's a PDF
        if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
            return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Extract text using pdf2json
        const pdfParser = new PDFParser(null, 1 as any); // 1 = text content only

        const text = await new Promise<string>((resolve, reject) => {
            pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
            pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
                // Raw text content is available via getRawTextContent()
                resolve(pdfParser.getRawTextContent());
            });
            pdfParser.parseBuffer(buffer);
        });

        return NextResponse.json({ text });
    } catch (error) {
        console.error("Error extracting PDF text:", error);
        return NextResponse.json(
            { error: "Failed to extract PDF text" },
            { status: 500 }
        );
    }
}
