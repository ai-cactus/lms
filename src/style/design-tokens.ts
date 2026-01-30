/**
 * Design Tokens - Extracted from Figma Style Guide
 * Source: https://www.figma.com/design/cySAabdYLDKzwbs88owBHn/THERAPTLY
 * 
 * These tokens define the visual language of the application.
 */

// =============================================================================
// COLOR TOKENS
// =============================================================================

/**
 * Gray/Neutral color scale - Foundation of the color system
 * Used for backgrounds, borders, and text
 */
export const colors = {
    gray: {
        0: '#FFFFFF',
        5: '#F8FAFC',
        10: '#F1F5F9',
        20: '#E2E8F0',
        30: '#CBD5E1',
        40: '#CBD5E1',
        50: '#64748B',
        60: '#475569',
        70: '#334155',
        80: '#1E293B',
        90: '#0F172A',
        100: '#000000',
    },

    /**
     * Brand/Primary color scale (Indigo)
     * Used for interactive components: buttons, links, inputs
     */
    brand: {
        5: '#EEF2FF',
        10: '#E0E7FF',
        20: '#C7D2FE',
        30: '#A5B4FC',
        40: '#818CF8',
        50: '#6366F1',
        60: '#4F46E5',
        70: '#4338CA',
        80: '#3730A3',
        90: '#312E81',
    },

    /**
     * Destructive/Error color scale (Rose)
     * Used for destructive actions and error states
     */
    destructive: {
        5: '#FFF1F2',
        10: '#FFE4E6',
        20: '#FECDD3',
        30: '#FDA4AF',
        40: '#FB7185',
        50: '#F43F5E',
        60: '#E11D48',
        70: '#BE123C',
        80: '#9F1239',
        90: '#881337',
    },

    /**
     * Warning color scale (Amber)
     * Used for warning states and alerts
     */
    warning: {
        5: '#FFFBEB',
        10: '#FEF3C7',
        20: '#FDE68A',
        30: '#FCD34D',
        40: '#FBBF24',
        50: '#F59E0B',
        60: '#D97706',
        70: '#B45309',
        80: '#92400E',
        90: '#78350F',
    },

    /**
     * Success color scale (Green)
     * Used for success states and positive feedback
     */
    success: {
        5: '#F0FDF4',
        10: '#DCFCE7',
        20: '#BBF7D0',
        30: '#86EFAC',
        40: '#4ADE80',
        50: '#22C55E',
        60: '#16A34A',
        70: '#166534',
        80: '#14532D',
        90: '#14532D',
    },
} as const;

// Semantic color aliases for easier usage
export const semanticColors = {
    // Background colors
    background: {
        primary: colors.gray[0],
        secondary: colors.gray[5],
        tertiary: colors.gray[10],
        inverse: colors.gray[90],
    },

    // Text colors
    text: {
        primary: colors.gray[90],
        secondary: colors.gray[60],
        tertiary: colors.gray[50],
        inverse: colors.gray[0],
        brand: colors.brand[60],
        error: colors.destructive[60],
        warning: colors.warning[60],
        success: colors.success[60],
    },

    // Border colors
    border: {
        default: colors.gray[20],
        subtle: colors.gray[10],
        strong: colors.gray[30],
        brand: colors.brand[50],
        error: colors.destructive[50],
    },

    // Interactive states
    interactive: {
        primary: colors.brand[60],
        primaryHover: colors.brand[70],
        primaryActive: colors.brand[80],
        danger: colors.destructive[60],
        dangerHover: colors.destructive[70],
    },
} as const;

// =============================================================================
// TYPOGRAPHY TOKENS
// =============================================================================

/**
 * Font families used in the design system
 */
export const fontFamilies = {
    primary: '"Inter Tight", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    secondary: '"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',
} as const;

/**
 * Font sizes in pixels and rem
 * Follows a modular type scale
 */
export const fontSizes = {
    xs: { px: 10, rem: '0.625rem' },
    sm: { px: 12, rem: '0.75rem' },
    base: { px: 14, rem: '0.875rem' },
    md: { px: 16, rem: '1rem' },
    lg: { px: 18, rem: '1.125rem' },
    xl: { px: 20, rem: '1.25rem' },
    '2xl': { px: 24, rem: '1.5rem' },
    '3xl': { px: 32, rem: '2rem' },
    '4xl': { px: 40, rem: '2.5rem' },
    '5xl': { px: 48, rem: '3rem' },
    '6xl': { px: 60, rem: '3.75rem' },
} as const;

/**
 * Font weights
 */
export const fontWeights = {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
} as const;

/**
 * Line heights
 */
export const lineHeights = {
    tight: 1.2,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
} as const;

/**
 * Letter spacing values
 */
export const letterSpacing = {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0em',
    wide: '0.025em',
    wider: '0.05em',
} as const;

/**
 * Typography presets for common text styles
 */
export const typography = {
    // Display headings
    display: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes['6xl'].rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.tight,
        letterSpacing: '-2.4px',
    },

    // Headings
    h1: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes['5xl'].rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.tight,
        letterSpacing: '-1.28px',
    },
    h2: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes['4xl'].rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.tight,
        letterSpacing: '-1px',
    },
    h3: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes['3xl'].rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.snug,
        letterSpacing: '-0.64px',
    },
    h4: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes['2xl'].rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.snug,
        letterSpacing: '-0.48px',
    },
    h5: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.xl.rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.normal,
        letterSpacing: '-0.4px',
    },
    h6: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.lg.rem,
        fontWeight: fontWeights.semibold,
        lineHeight: lineHeights.normal,
        letterSpacing: '0',
    },

    // Body text
    bodyLarge: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.lg.rem,
        fontWeight: fontWeights.regular,
        lineHeight: lineHeights.relaxed,
        letterSpacing: '0',
    },
    body: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.base.rem,
        fontWeight: fontWeights.regular,
        lineHeight: lineHeights.normal,
        letterSpacing: '0',
    },
    bodySmall: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.sm.rem,
        fontWeight: fontWeights.regular,
        lineHeight: lineHeights.normal,
        letterSpacing: '0',
    },
    bodyXSmall: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.xs.rem,
        fontWeight: fontWeights.regular,
        lineHeight: lineHeights.normal,
        letterSpacing: '0.4px',
    },

    // Labels and captions
    label: {
        fontFamily: fontFamilies.primary,
        fontSize: fontSizes.sm.rem,
        fontWeight: fontWeights.medium,
        lineHeight: lineHeights.normal,
        letterSpacing: '0',
    },
    caption: {
        fontFamily: fontFamilies.secondary,
        fontSize: fontSizes.xs.rem,
        fontWeight: fontWeights.regular,
        lineHeight: lineHeights.normal,
        letterSpacing: '0.2px',
    },
} as const;

// =============================================================================
// SPACING TOKENS
// =============================================================================

/**
 * Spacing scale using Tailwind conventions
 * Base unit: 4px (0.25rem)
 */
export const spacing = {
    0: '0px',
    px: '1px',
    0.5: '2px',
    1: '4px',
    1.5: '6px',
    2: '8px',
    2.5: '10px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    7: '28px',
    8: '32px',
    9: '36px',
    10: '40px',
    11: '44px',
    12: '48px',
    14: '56px',
    16: '64px',
    20: '80px',
    24: '96px',
    28: '112px',
    32: '128px',
    36: '144px',
    40: '160px',
    44: '176px',
    48: '192px',
    52: '208px',
    56: '224px',
    60: '240px',
    64: '256px',
    72: '288px',
    80: '320px',
    96: '384px',
} as const;

// =============================================================================
// BORDER RADIUS TOKENS
// =============================================================================

/**
 * Border radius values
 */
export const borderRadius = {
    none: '0px',
    sm: '4px',
    default: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '32px',
    full: '9999px',
} as const;

// =============================================================================
// SHADOW TOKENS
// =============================================================================

/**
 * Shadow definitions extracted from Figma effects
 */
export const shadows = {
    none: 'none',

    // Subtle shadows for cards and containers
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',

    // Default shadow for elevated elements
    default: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',

    // Medium shadow for dropdowns and popovers
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',

    // Large shadow for modals
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',

    // Extra large shadow for floating elements
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',

    // 2XL shadow for hero elements
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',

    // Inner shadow for inset effects
    inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',

    // Brand-colored shadows (from Figma)
    brandGlow: '0 0 0 1px rgba(99, 102, 241, 0.5), 0 1px 2px rgba(0, 0, 0, 0.32), 0 4px 8px -4px rgba(0, 0, 0, 0.32)',

    // Focus ring
    focusRing: '0 0 0 2px #FFFFFF, 0 0 0 4px #6366F1',
} as const;

// =============================================================================
// BREAKPOINT TOKENS
// =============================================================================

/**
 * Responsive breakpoints for media queries
 */
export const breakpoints = {
    xs: '320px',
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
} as const;

/**
 * Media query helpers
 */
export const mediaQueries = {
    xs: `@media (min-width: ${breakpoints.xs})`,
    sm: `@media (min-width: ${breakpoints.sm})`,
    md: `@media (min-width: ${breakpoints.md})`,
    lg: `@media (min-width: ${breakpoints.lg})`,
    xl: `@media (min-width: ${breakpoints.xl})`,
    '2xl': `@media (min-width: ${breakpoints['2xl']})`,
} as const;

// =============================================================================
// TRANSITION TOKENS
// =============================================================================

/**
 * Transition timing values
 */
export const transitions = {
    duration: {
        fast: '150ms',
        default: '200ms',
        slow: '300ms',
        slower: '500ms',
    },
    timing: {
        default: 'cubic-bezier(0.4, 0, 0.2, 1)',
        linear: 'linear',
        easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
        easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
        easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
} as const;

// =============================================================================
// Z-INDEX TOKENS
// =============================================================================

/**
 * Z-index scale for layering
 */
export const zIndex = {
    hide: -1,
    base: 0,
    raised: 1,
    dropdown: 1000,
    sticky: 1100,
    overlay: 1200,
    modal: 1300,
    popover: 1400,
    tooltip: 1500,
    toast: 1600,
} as const;

// =============================================================================
// EXPORT ALL TOKENS
// =============================================================================

export const designTokens = {
    colors,
    semanticColors,
    fontFamilies,
    fontSizes,
    fontWeights,
    lineHeights,
    letterSpacing,
    typography,
    spacing,
    borderRadius,
    shadows,
    breakpoints,
    mediaQueries,
    transitions,
    zIndex,
} as const;

export default designTokens;
