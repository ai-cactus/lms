export function chunkText(text: string, maxChunkSize: number = 50000): string[] {
    const chunks: string[] = [];
    let currentChunk = "";

    // Split by paragraphs first to avoid breaking sentences mid-way if possible
    const paragraphs = text.split("\n\n");

    for (const paragraph of paragraphs) {
        if ((currentChunk.length + paragraph.length) > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }

            // If a single paragraph is too large, we must split it
            if (paragraph.length > maxChunkSize) {
                let tempParagraph = paragraph;
                while (tempParagraph.length > 0) {
                    const slice = tempParagraph.slice(0, maxChunkSize);
                    chunks.push(slice);
                    tempParagraph = tempParagraph.slice(maxChunkSize);
                }
            } else {
                currentChunk = paragraph;
            }
        } else {
            if (currentChunk) {
                currentChunk += "\n\n" + paragraph;
            } else {
                currentChunk = paragraph;
            }
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}
