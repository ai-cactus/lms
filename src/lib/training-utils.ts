/**
 * Parse markdown content to extract table of contents from headers
 * @param markdown - The markdown content to parse
 * @returns Array of section objects with id, level, and title
 */
export interface ToCSection {
    id: string;
    level: number;
    title: string;
    slug: string;
}

export function parseTableOfContents(markdown: string): ToCSection[] {
    if (!markdown) return [];

    const sections: ToCSection[] = [];
    const lines = markdown.split('\n');

    lines.forEach((line, index) => {
        // Match markdown headers (## Header or ### Header, etc)
        const match = line.match(/^(#{2,3})\s+(.+)$/);
        if (match) {
            const level = match[1].length; // 2 for ##, 3 for ###
            const title = match[2].trim();
            const slug = title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');

            sections.push({
                id: `section-${index}`,
                level,
                title,
                slug
            });
        }
    });

    return sections;
}

/**
 * Calculate progress percentage based on sections viewed
 * @param totalSections - Total number of sections in the course
 * @param viewedSections - Array of section ids that have been viewed
 * @returns Progress percentage (0-100)
 */
export function calculateProgress(totalSections: number, viewedSections: string[]): number {
    if (totalSections === 0) return 0;
    return Math.round((viewedSections.length / totalSections) * 100);
}

/**
 * Format time remaining for quiz timer
 * @param seconds - Seconds remaining
 * @returns Formatted time string (MM:SS)
 */
export function formatTimeRemaining(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Check if quiz time has expired
 * @param startTime - ISO timestamp when quiz started
 * @param timeLimitMinutes - Time limit in minutes
 * @returns True if time has expired
 */
export function isQuizTimeExpired(startTime: string, timeLimitMinutes: number): boolean {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const elapsed = (now - start) / 1000 / 60; // minutes
    return elapsed >= timeLimitMinutes;
}

/**
 * Get remaining time in seconds
 * @param startTime - ISO timestamp when quiz started
 * @param timeLimitMinutes - Time limit in minutes
 * @returns Remaining seconds (0 if expired)
 */
export function getRemainingSeconds(startTime: string, timeLimitMinutes: number): number {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const elapsedSeconds = (now - start) / 1000;
    const totalSeconds = timeLimitMinutes * 60;
    const remaining = Math.max(0, totalSeconds - elapsedSeconds);
    return Math.floor(remaining);
}
