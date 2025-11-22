/**
 * Utility functions for converting course content between different delivery formats
 */

/**
 * Converts continuous markdown text into slides by inserting horizontal rules
 * at logical break points (H2 headers, major sections)
 */
export function convertToSlides(markdown: string): string {
    if (!markdown || markdown.trim() === '') return markdown;

    // Split by lines
    const lines = markdown.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;
    let slideCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track code blocks to avoid breaking inside them
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }

        // Don't add breaks inside code blocks
        if (inCodeBlock) {
            result.push(line);
            continue;
        }

        // Add the current line
        result.push(line);

        // Insert slide break after H2 headers (## Module X)
        // But not if it's the first slide or if there's already a break
        if (trimmed.startsWith('## ') && slideCount > 0) {
            const nextLine = lines[i + 1];
            // Don't add if next line is already a separator or empty
            if (nextLine && nextLine.trim() !== '---' && nextLine.trim() !== '') {
                result.push('');
                result.push('---');
                result.push('');
                slideCount++;
            }
        }

        // Track first H1 as first slide
        if (trimmed.startsWith('# ') && slideCount === 0) {
            slideCount = 1;
        }
    }

    return result.join('\n');
}

/**
 * Removes slide breaks to convert back to continuous text
 */
export function convertToPages(markdown: string): string {
    if (!markdown || markdown.trim() === '') return markdown;

    // Remove horizontal rules that are used as slide separators
    // Keep those that are part of the content (e.g., in tables)
    const lines = markdown.split('\n');
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip standalone horizontal rules (slide separators)
        // These are typically surrounded by empty lines
        if (trimmed === '---') {
            const prevLine = i > 0 ? lines[i - 1].trim() : '';
            const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';

            // If it's a standalone separator (empty lines around it), skip it
            if (prevLine === '' && nextLine === '') {
                continue;
            }
        }

        result.push(line);
    }

    return result.join('\n');
}

/**
 * Counts the number of slides in markdown content
 */
export function countSlides(markdown: string): number {
    if (!markdown || markdown.trim() === '') return 0;

    // Split by horizontal rules
    const slides = markdown.split(/^---$/m).filter(s => s.trim() !== '');
    return slides.length;
}
