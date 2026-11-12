/**
 * WCAG 2.1 AA Contrast Ratio Verification for Apple-HIG Tokens
 * Requires contrast ratio >= 4.5:1 for standard body text against background surfaces.
 */

function sRgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
}

function getContrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = getRelativeLuminance(rgb1);
  const l2 = getRelativeLuminance(rgb2);
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (brighter + 0.05) / (darker + 0.05);
}

describe('Apple-HIG Design Tokens WCAG AA Contrast Compliance', () => {
  describe('Alabaster Light Theme Tokens', () => {
    const lightCanvas: [number, number, number] = [245, 245, 247]; // #F5F5F7
    const lightSurface: [number, number, number] = [255, 255, 255]; // #FFFFFF
    const lightTextPrimary: [number, number, number] = [29, 29, 31]; // #1D1D1F
    const lightAccentText: [number, number, number] = [0, 102, 204]; // #0066CC
    const lightSuccess: [number, number, number] = [0, 120, 44]; // #00782C

    it('ensures primary text meets WCAG AA (>= 4.5:1) on light canvas', () => {
      const ratio = getContrastRatio(lightTextPrimary, lightCanvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(10); // Typically ~16:1
    });

    it('ensures primary text meets WCAG AA (>= 4.5:1) on light surface', () => {
      const ratio = getContrastRatio(lightTextPrimary, lightSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(15);
    });

    it('ensures accent text meets WCAG AA (>= 4.5:1) on white surface', () => {
      const ratio = getContrastRatio(lightAccentText, lightSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures success text meets WCAG AA (>= 4.5:1) on white surface', () => {
      const ratio = getContrastRatio(lightSuccess, lightSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('Obsidian Dark Theme Tokens', () => {
    const darkCanvas: [number, number, number] = [0, 0, 0]; // #000000
    const darkSurface: [number, number, number] = [28, 28, 30]; // #1C1C1E
    const darkTextPrimary: [number, number, number] = [245, 245, 247]; // #F5F5F7
    const darkAccentText: [number, number, number] = [41, 151, 255]; // #2997FF
    const darkSuccess: [number, number, number] = [48, 209, 88]; // #30D158

    it('ensures primary text meets WCAG AA (>= 4.5:1) on dark canvas', () => {
      const ratio = getContrastRatio(darkTextPrimary, darkCanvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(18); // ~18.8:1
    });

    it('ensures primary text meets WCAG AA (>= 4.5:1) on dark surface', () => {
      const ratio = getContrastRatio(darkTextPrimary, darkSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(14);
    });

    it('ensures accent text meets WCAG AA (>= 4.5:1) on dark canvas & surface', () => {
      const canvasRatio = getContrastRatio(darkAccentText, darkCanvas);
      const surfaceRatio = getContrastRatio(darkAccentText, darkSurface);
      expect(canvasRatio).toBeGreaterThanOrEqual(4.5);
      expect(surfaceRatio).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures success text meets WCAG AA (>= 4.5:1) on dark canvas & surface', () => {
      const canvasRatio = getContrastRatio(darkSuccess, darkCanvas);
      const surfaceRatio = getContrastRatio(darkSuccess, darkSurface);
      expect(canvasRatio).toBeGreaterThanOrEqual(4.5);
      expect(surfaceRatio).toBeGreaterThanOrEqual(4.5);
    });
  });
});
