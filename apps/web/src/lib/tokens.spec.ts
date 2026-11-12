/**
 * WCAG 2.1 AA Contrast Ratio Verification for Editorial-Meets-HUD Tokens
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

describe('Editorial-Meets-HUD Design Tokens WCAG AA Contrast Compliance', () => {
  describe('Stark White Light Theme Tokens', () => {
    const lightCanvas: [number, number, number] = [255, 255, 255]; // #FFFFFF
    const lightSurface: [number, number, number] = [250, 250, 250]; // #FAFAFA
    const lightTextPrimary: [number, number, number] = [0, 0, 0]; // #000000
    const lightAccentText: [number, number, number] = [185, 28, 28]; // #B91C1C
    const lightSuccess: [number, number, number] = [0, 120, 44]; // #00782C Dark Forest Green for AA on white

    it('ensures primary text meets WCAG AA (>= 4.5:1) on light canvas', () => {
      const ratio = getContrastRatio(lightTextPrimary, lightCanvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(15); // Exactly 21:1
    });

    it('ensures primary text meets WCAG AA (>= 4.5:1) on light surface', () => {
      const ratio = getContrastRatio(lightTextPrimary, lightSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(15);
    });

    it('ensures accent text meets WCAG AA (>= 4.5:1) on white canvas & surface', () => {
      const ratioCanvas = getContrastRatio(lightAccentText, lightCanvas);
      const ratioSurface = getContrastRatio(lightAccentText, lightSurface);
      expect(ratioCanvas).toBeGreaterThanOrEqual(4.5);
      expect(ratioSurface).toBeGreaterThanOrEqual(4.5);
    });

    it('ensures success text meets WCAG AA (>= 4.5:1) on white surface', () => {
      const ratio = getContrastRatio(lightSuccess, lightSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('Pitch Black Obsidian Dark Theme Tokens', () => {
    const darkCanvas: [number, number, number] = [0, 0, 0]; // #000000
    const darkSurface: [number, number, number] = [10, 10, 10]; // #0A0A0A
    const darkTextPrimary: [number, number, number] = [255, 255, 255]; // #FFFFFF
    const darkAccentText: [number, number, number] = [239, 68, 68]; // #EF4444
    const darkSuccess: [number, number, number] = [34, 197, 94]; // #22C55E

    it('ensures primary text meets WCAG AA (>= 4.5:1) on dark canvas', () => {
      const ratio = getContrastRatio(darkTextPrimary, darkCanvas);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(18); // Exactly 21:1
    });

    it('ensures primary text meets WCAG AA (>= 4.5:1) on dark surface', () => {
      const ratio = getContrastRatio(darkTextPrimary, darkSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(15);
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
