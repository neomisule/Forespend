// Money arrives from the backend as decimal strings like "1200.00" or "-300.00".
// We never turn them into JavaScript floats (0.1 + 0.2 !== 0.3). Instead we use
// BigInt whole cents, so any arithmetic we display is exact.

const MONEY = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function toCents(value: string): bigint {
  const m = MONEY.exec(value.trim());
  if (!m) throw new Error(`Not a money value: ${JSON.stringify(value)}`);
  const cents = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

export function isMoney(value: unknown): value is string {
  return typeof value === "string" && MONEY.test(value.trim());
}

/** 120000n -> "$1,200.00"; -30000n -> "−$300.00" (a real minus sign, read aloud as "minus"). */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = (abs / 100n).toLocaleString("en-US");
  const rest = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}$${dollars}.${rest}`;
}

export function formatMoney(value: string): string {
  return formatCents(toCents(value));
}

/** Short form for tight spaces: "$850" when there are no cents, otherwise "$45.50". Still exact. */
export function formatMoneyCompact(value: string): string {
  const full = formatMoney(value);
  return full.endsWith(".00") ? full.slice(0, -3) : full;
}

/** Exact a − b, e.g. for "net change today". */
export function differenceCents(a: string, b: string): bigint {
  return toCents(a) - toCents(b);
}

/**
 * Turns what a person typed ("600", "$1,250.5") into the exact string the API
 * expects ("600.00"), or null if it isn't a positive amount with at most 2 decimals.
 */
export function normalizeAmountInput(input: string): string | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = toCents(cleaned);
  if (cents <= 0n) return null;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function formatSignedCents(cents: bigint): string {
  if (cents === 0n) return "$0.00";
  return cents > 0n ? `+${formatCents(cents)}` : formatCents(cents);
}
