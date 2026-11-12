/**
 * FlowGate Theme Transition with Circular View-Transition Reveal
 * Uses the Web View Transitions API with CSS clip-path animation expanding from the click origin.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export async function applyThemeWithReveal(
  nextTheme: ResolvedTheme,
  origin?: { x: number; y: number },
): Promise<void> {
  const root = document.documentElement;

  // Check if reduced motion is requested
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // If View Transitions API is not available or reduced motion is preferred, switch immediately
  if (!('startViewTransition' in document) || prefersReducedMotion) {
    root.dataset.theme = nextTheme;
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;

  // Calculate maximum distance to the furthest screen corner for full circular coverage
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = (document as any).startViewTransition(() => {
    root.dataset.theme = nextTheme;
  });

  try {
    await transition.ready;
    document.documentElement.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
      },
      {
        duration: 550,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  } catch {
    // If transition animation fails, state is already updated via callback
  }
}
