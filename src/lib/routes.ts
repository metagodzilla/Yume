/** Cast is a stack screen. A hidden tab route such as /(tabs)/cast opens Home and looks like a dead tap. */
export const CAST_ROUTE = '/cast';

export function castRouteOpensScreen(path: string): boolean {
  return path === CAST_ROUTE;
}
