/**
 * Resolve CSS variable color (var(--affine-xxx)) using computed styles
 */
export function resolveCssVariable(color: string): string | null {
  if (!color || typeof color !== 'string') {
    return null;
  }
  if (!color.startsWith('var(')) {
    return color;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const rootComputedStyle = getComputedStyle(document.documentElement);
  // Anchored: the guard above already established that `color` starts with
  // `var(`, so only offset 0 can match. Unanchored, the engine retries from
  // every later `var(` and rescans to the end each time, which costs quadratic
  // time on a value like `'var(' + 'var(('.repeat(40_000)`.
  const match = color.match(/^var\(([^)]+)\)/);
  if (!match || !match[1]) {
    return null;
  }
  const variable = match[1].trim();
  if (!variable.startsWith('--')) {
    return null;
  }
  const value = rootComputedStyle.getPropertyValue(variable).trim();
  return value || null;
}
