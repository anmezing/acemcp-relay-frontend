export const BYTE_UNIT_OPTIONS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

export type ByteUnit = (typeof BYTE_UNIT_OPTIONS)[number];

export interface ByteQuotaDraft {
  amount: string;
  unit: ByteUnit;
}

export const DEFAULT_BYTE_QUOTA_UNIT: ByteUnit = "GiB";

const BIGINT_ZERO = BigInt(0);
const BIGINT_TWO = BigInt(2);
const BIGINT_TEN = BigInt(10);
const BIGINT_KIB = BigInt(1024);

const BYTE_UNIT_MULTIPLIERS: Record<ByteUnit, bigint> = {
  B: BigInt(1),
  KiB: BIGINT_KIB,
  MiB: BIGINT_KIB ** BIGINT_TWO,
  GiB: BIGINT_KIB ** BigInt(3),
  TiB: BIGINT_KIB ** BigInt(4),
};

const BYTE_UNITS_DESCENDING: readonly ByteUnit[] = [
  "TiB",
  "GiB",
  "MiB",
  "KiB",
  "B",
];

const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);
const BYTE_AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function bytesToQuotaDraft(
  bytes: number | null,
  defaultUnit: ByteUnit = DEFAULT_BYTE_QUOTA_UNIT
): ByteQuotaDraft {
  if (bytes === null) return { amount: "", unit: defaultUnit };
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Invalid byte quota: ${String(bytes)}`);
  }
  if (bytes === 0) return { amount: "0", unit: defaultUnit };

  const exactBytes = BigInt(bytes);
  for (const unit of BYTE_UNITS_DESCENDING) {
    const multiplier = BYTE_UNIT_MULTIPLIERS[unit];
    if (exactBytes % multiplier === BIGINT_ZERO) {
      return {
        amount: String(exactBytes / multiplier),
        unit,
      };
    }
  }

  return { amount: String(bytes), unit: "B" };
}

// blank = inherit/default; 0 = unlimited; otherwise convert the selected
// human-readable unit into the integer byte value used by the API and Relay.
// Fractional binary units are rounded to the nearest byte. A positive value
// that would round to zero is rejected so it cannot accidentally mean unlimited.
export function quotaDraftToBytes(
  amount: string,
  unit: ByteUnit
): number | null | undefined {
  const raw = amount.trim();
  if (raw === "") return null;
  // A quota can never need more than 16 whole-number digits within JS's safe
  // integer range. Bound the input before BigInt exponentiation so pasted
  // pathological decimal strings cannot block the admin page.
  if (raw.length > 32) return undefined;

  const match = raw.match(BYTE_AMOUNT_PATTERN);
  if (!match) return undefined;

  const whole = match[1];
  const fraction = match[2] ?? "";
  if (unit === "B" && /[1-9]/.test(fraction)) return undefined;

  const denominator = BIGINT_TEN ** BigInt(fraction.length);
  const decimalDigits = BigInt(`${whole}${fraction}`);
  const numerator = decimalDigits * BYTE_UNIT_MULTIPLIERS[unit];
  const roundedBytes = (numerator + denominator / BIGINT_TWO) / denominator;

  if (numerator > BIGINT_ZERO && roundedBytes === BIGINT_ZERO) return undefined;
  if (roundedBytes > MAX_SAFE_BYTES) return undefined;
  return Number(roundedBytes);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";

  let amount = bytes;
  let unitIndex = 0;
  while (
    amount >= 1024 &&
    unitIndex < BYTE_UNIT_OPTIONS.length - 1
  ) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${
    amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)
  } ${BYTE_UNIT_OPTIONS[unitIndex]}`;
}

export function formatByteLimit(bytes: number, unlimited: string): string {
  return bytes === 0 ? unlimited : formatBytes(bytes);
}
