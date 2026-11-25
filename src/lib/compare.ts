/** Wide screens put the original on the left. A narrow phone stacks it above the results. */
export function compareDirection(width: number): 'row' | 'column' {
  return width > 0 && width < 520 ? 'column' : 'row';
}
