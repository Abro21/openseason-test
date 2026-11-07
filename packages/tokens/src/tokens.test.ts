import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, cssVariables, space, toneColors, type StatusTone } from './index';

describe('tokens', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const c = colors[scheme];
    it(`${scheme}: body text meets AAA on background and surface`, () => {
      expect(contrastRatio(c.text, c.background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(7);
    });
    it(`${scheme}: muted text meets AA on surface`, () => {
      expect(contrastRatio(c.textMuted, c.surface)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${scheme}: accent button text meets AA`, () => {
      expect(contrastRatio(c.textOnAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${scheme}: every status chip meets AA`, () => {
      const tones: StatusTone[] = ['neutral', 'success', 'warning', 'danger', 'info', 'pending', 'sandbox'];
      for (const t of tones) {
        const { fg, bg } = toneColors(scheme, t);
        expect(contrastRatio(fg, bg), t).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('spacing is on the 4/8 grid', () => {
    for (const v of Object.values(space)) expect(v % 4).toBe(0);
  });
  it('emits css variables for every semantic colour', () => {
    const css = cssVariables('light');
    expect(css).toContain('--os-accent:');
    expect(css).toContain('--os-touch-min: 44px');
  });
});
