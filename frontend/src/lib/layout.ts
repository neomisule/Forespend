/**
 * Height for each calendar week row so the whole month fits on screen.
 * Never below `minRow`: if there isn't room (short window, zoomed-in text),
 * rows keep their minimum and the page simply scrolls instead of clipping.
 */
export function fitRowHeight(opts: {
  viewport: number; // window.innerHeight
  tableTop: number; // where the table starts, measured from the top of the page
  head: number; // weekday header height
  reserveBelow: number; // space needed under the grid
  weeks: number; // 4–6
  spacing: number; // border-spacing between rows
  minRow: number;
}): number {
  const free = opts.viewport - opts.tableTop - opts.head - opts.reserveBelow - opts.spacing * (opts.weeks + 1);
  return Math.max(opts.minRow, Math.floor(free / opts.weeks));
}
