import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export async function POST(request: NextRequest) {
    try {
        const { fileUrl } = await request.json();

        if (!fileUrl) {
            return NextResponse.json(
                { error: "File URL is required" },
                { status: 400 }
            );
        }

        // Fetch the document from the URL
        const response = await fetch(fileUrl);
        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch document" },
                { status: 500 }
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Convert DOCX to HTML using mammoth
        const result = await mammoth.convertToHtml({ buffer });

        return NextResponse.json({
            html: result.value,
            messages: result.messages
        });
    } catch (error) {
        console.error("Error converting document:", error);
        return NextResponse.json(
            { error: "Failed to convert document" },
            { status: 500 }
        );
    }
}
