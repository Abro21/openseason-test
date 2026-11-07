/**
 * OpenSeason design tokens.
 *
 * Source: the brand foundation was not available (open-season/openseason is not
 * readable from this workspace). These values follow the brief's direction
 * (restrained neutrals, one accent, distinct semantic status colours) and the
 * public marketing palette (midnight navy, mint action). Treat them as the
 * single source of truth: web turns them into CSS variables, mobile reads them
 * directly. Never hard-code colours in feature code.
 */

export const palette = {
  navy950: '#0A1020',
  navy900: '#101828',
  navy800: '#1B2436',
  navy700: '#2A3448',
  slate600: '#475467',
  slate500: '#667085',
  slate400: '#98A2B3',
  slate300: '#D0D5DD',
  slate200: '#E4E7EC',
  slate100: '#F2F4F7',
  slate50: '#F9FAFB',
  white: '#FFFFFF',
  mint700: '#047A48',
  mint600: '#05A35F',
  mint500: '#12C77A',
  mint300: '#7EE8B8',
  mint100: '#DCFBEA',
  amber700: '#B54708',
  amber100: '#FEF0C7',
  red700: '#B42318',
  red400: '#F97066',
  red100: '#FEE4E2',
  blue700: '#175CD3',
  blue400: '#84ADFF',
  blue100: '#D1E9FF',
  violet700: '#5925DC',
  violet100: '#EBE9FE',
} as const;

export type ColorScheme = 'light' | 'dark';

export interface SemanticColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textOnAccent: string;
  accent: string;
  accentPressed: string;
  accentSubtle: string;
  focusRing: string;
  selected: string;
  selectedBorder: string;
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
  info: string;
  infoSubtle: string;
  pending: string;
  pendingSubtle: string;
  sandbox: string;
  sandboxSubtle: string;
}

/* Contrast: text on background >= 7:1 and textMuted >= 4.5:1 in both schemes
 * (checked in tokens.test.ts with the WCAG relative-luminance formula). */
export const colors: Record<ColorScheme, SemanticColors> = {
  light: {
    background: palette.slate50,
    surface: palette.white,
    surfaceRaised: palette.white,
    border: palette.slate200,
    borderStrong: palette.slate300,
    text: palette.navy900,
    textMuted: palette.slate600,
    textOnAccent: palette.white,
    accent: palette.mint700,
    accentPressed: '#03623A',
    accentSubtle: palette.mint100,
    focusRing: palette.blue700,
    selected: palette.mint100,
    selectedBorder: palette.mint700,
    success: palette.mint700,
    successSubtle: palette.mint100,
    warning: palette.amber700,
    warningSubtle: palette.amber100,
    danger: palette.red700,
    dangerSubtle: palette.red100,
    info: palette.blue700,
    infoSubtle: palette.blue100,
    pending: palette.violet700,
    pendingSubtle: palette.violet100,
    sandbox: palette.amber700,
    sandboxSubtle: palette.amber100,
  },
  dark: {
    background: palette.navy950,
    surface: palette.navy900,
    surfaceRaised: palette.navy800,
    border: palette.navy700,
    borderStrong: palette.slate600,
    text: palette.slate50,
    textMuted: palette.slate400,
    textOnAccent: palette.navy950,
    accent: palette.mint500,
    accentPressed: palette.mint300,
    accentSubtle: '#0E3B2A',
    focusRing: palette.blue400,
    selected: '#0E3B2A',
    selectedBorder: palette.mint500,
    success: palette.mint500,
    successSubtle: '#0E3B2A',
    warning: '#FDB022',
    warningSubtle: '#3D2A06',
    danger: palette.red400,
    dangerSubtle: '#3F1512',
    info: palette.blue400,
    infoSubtle: '#102A56',
    pending: '#BDB4FE',
    pendingSubtle: '#2B1F5C',
    sandbox: '#FDB022',
    sandboxSubtle: '#3D2A06',
  },
};

/** 4/8 spacing scale, in px (web) / dp (native). */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;
export type SpaceKey = keyof typeof space;

export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;

/** Small type scale. Sizes are base values; both platforms scale with OS settings. */
export const type = {
  caption: { size: 12, lineHeight: 16, weight: '500' },
  body: { size: 16, lineHeight: 24, weight: '400' },
  bodyStrong: { size: 16, lineHeight: 24, weight: '600' },
  label: { size: 14, lineHeight: 20, weight: '600' },
  title: { size: 20, lineHeight: 28, weight: '600' },
  heading: { size: 24, lineHeight: 32, weight: '700' },
} as const;
export type TypeKey = keyof typeof type;

export const fontFamily = {
  web: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /* Native uses the platform system font when fontFamily is undefined. */
  native: undefined,
} as const;

export const touch = { minTarget: 44 } as const;

export const elevation = {
  none: 'none',
  raised: '0 1px 2px rgba(16, 24, 40, 0.08)',
  overlay: '0 8px 24px rgba(16, 24, 40, 0.18)',
} as const;

export const motion = {
  fast: 120,
  base: 200,
  /** Use 0 when the OS asks for reduced motion. */
  reduced: 0,
} as const;

export const breakpoints = { compact: 0, medium: 720, wide: 1100 } as const;

/** Status vocabulary shared by chips on every platform. Every status has a text label;
 * colour is never the only signal. */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'pending' | 'sandbox';

export function toneColors(scheme: ColorScheme, tone: StatusTone): { fg: string; bg: string } {
  const c = colors[scheme];
  switch (tone) {
    case 'success': return { fg: c.success, bg: c.successSubtle };
    case 'warning': return { fg: c.warning, bg: c.warningSubtle };
    case 'danger': return { fg: c.danger, bg: c.dangerSubtle };
    case 'info': return { fg: c.info, bg: c.infoSubtle };
    case 'pending': return { fg: c.pending, bg: c.pendingSubtle };
    case 'sandbox': return { fg: c.sandbox, bg: c.sandboxSubtle };
    default: return { fg: c.textMuted, bg: c.background };
  }
}

/** CSS custom properties for web. Generated, never hand-written. */
export function cssVariables(scheme: ColorScheme): string {
  const c = colors[scheme];
  const lines = Object.entries(c).map(([k, v]) => `  --os-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(space)) lines.push(`  --os-space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(radius)) lines.push(`  --os-radius-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(type)) {
    lines.push(`  --os-type-${kebab(k)}-size: ${v.size / 16}rem;`);
    lines.push(`  --os-type-${kebab(k)}-line: ${v.lineHeight / v.size};`);
    lines.push(`  --os-type-${kebab(k)}-weight: ${v.weight};`);
  }
  lines.push(`  --os-touch-min: ${touch.minTarget}px;`);
  lines.push(`  --os-font: ${fontFamily.web};`);
  lines.push(`  --os-elevation-raised: ${elevation.raised};`);
  lines.push(`  --os-elevation-overlay: ${elevation.overlay};`);
  lines.push(`  --os-motion-fast: ${motion.fast}ms;`);
  lines.push(`  --os-motion-base: ${motion.base}ms;`);
  return lines.join('\n');
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}
