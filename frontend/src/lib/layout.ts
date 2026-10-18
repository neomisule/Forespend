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

export const GRID_COLUMNS = 7;
export const GRID_SPACING = 4; // px between cells (border-spacing-1)
export const CELL_PADDING_REM = 0.75; // the day button's horizontal padding (px-1.5 on each side)

/**
 * The width a day cell has for text, given the width of the calendar area.
 * The table is 0.5rem wider than its area (it pulls out by the cell spacing on
 * each side), there is a spacing gap on both sides of every column, and the
 * button inside pads 0.375rem on each side.
 */
export function cellContentWidth(areaWidth: number, rem: number): number {
  const table = areaWidth + 0.5 * rem;
  return (table - GRID_SPACING * (GRID_COLUMNS + 1)) / GRID_COLUMNS - CELL_PADDING_REM * rem;
}

/**
 * Can every end-of-day balance be shown whole in the grid? `widestBalance` is the
 * measured width of the month's longest balance text (e.g. "≈$1,200.00") at the
 * current font size. When it does not fit, the calendar shows its list instead of
 * shrinking the text or cutting the amount.
 */
export function balancesFitGrid(widestBalance: number, areaWidth: number, rem: number): boolean {
  return widestBalance <= cellContentWidth(areaWidth, rem);
}
