/**
 * Equity reference evidence for Bell's optional premium cap. Pure and shared by the API (which
 * gathers the evidence) and the policy (which judges a quote against it), so the browser and
 * server agree byte for byte.
 *
 * xStocks are Token-2022 mints with the scaled-UI-amount extension: one raw token unit is worth
 * `multiplier` share-equivalents, and the multiplier drifts as dividends are reinvested. It is
 * stored on-chain as an f64; we convert that f64 to its exact rational value so no rounding ever
 * moves a quote across the user's limit. Every check fails closed: missing, stale, low-confidence
 * or out-of-session data makes the reference unavailable, never estimated.
 */

export type MarketSession = "regular" | "extended" | "closed" | "unknown";

export type ReferenceGap =
  | "NOT_CONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "MARKET_NOT_REGULAR"
  | "STALE"
  | "LOW_CONFIDENCE"
  | "MULTIPLIER_UNAVAILABLE";

export interface Rational {
  numerator: string;
  denominator: string;
}

export interface ReferencePrice {
  /** Pyth fixed-point: value = price × 10^expo USD per share. */
  price: string;
  conf: string;
  expo: number;
  /** Unix seconds. */
  publishTime: number;
}

export interface BellReference {
  status: "available" | "unavailable";
  marketSession: MarketSession;
  reason?: ReferenceGap;
  source?: string;
  feedSymbol?: string;
  price?: ReferencePrice;
  multiplier?: Rational;
}

/** Older than this relative to the quote, a regular-session equity price is not current. */
export const REFERENCE_MAX_AGE_MS = 60_000;
/** A confidence interval wider than this share of the price is not a usable reference. */
export const REFERENCE_MAX_CONF_BPS = 200n;
const MULTIPLIER_MIN = { numerator: 1n, denominator: 1000n };
const MULTIPLIER_MAX = 1000n;

/** The exact value of an IEEE-754 double as a reduced fraction. Rejects non-positive values. */
export function float64Rational(value: number): { numerator: bigint; denominator: bigint } {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error("Invalid multiplier.");
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & ((1n << 52n) - 1n);
  let exponent: number;
  if (biased === 0) exponent = -1074;
  else {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  if (exponent >= 0) return { numerator: mantissa << BigInt(exponent), denominator: 1n };
  let denominator = 1n << BigInt(-exponent);
  while (mantissa % 2n === 0n && denominator > 1n) {
    mantissa /= 2n;
    denominator /= 2n;
  }
  return { numerator: mantissa, denominator };
}

/**
 * The multiplier in force at `nowSeconds`: Token-2022 switches to `newMultiplier` once its
 * effective timestamp passes. Values outside 1/1000…1000 are treated as corrupt.
 */
export function effectiveMultiplier(
  config: { multiplier: number; newMultiplier: number; newMultiplierEffectiveTimestamp: bigint },
  nowSeconds: number,
): Rational {
  const raw =
    BigInt(Math.floor(nowSeconds)) >= config.newMultiplierEffectiveTimestamp
      ? config.newMultiplier
      : config.multiplier;
  const { numerator, denominator } = float64Rational(raw);
  if (
    numerator * MULTIPLIER_MIN.denominator < MULTIPLIER_MIN.numerator * denominator ||
    numerator > MULTIPLIER_MAX * denominator
  )
    throw new Error("Multiplier out of range.");
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

interface Schedule {
  timeZone: string;
  weekly: string[];
  holidays: Map<string, string>;
}

/** Pyth schedule: `Zone;Mon,…,Sun;MMDD/spec,…` where spec is O, C or HHMM-HHMM[&…]. */
export function parseSchedule(schedule: string): Schedule {
  const [timeZone, weekly, holidays = ""] = schedule.split(";");
  const days = weekly?.split(",") ?? [];
  const spec = /^(O|C|\d{4}-\d{4}(&\d{4}-\d{4})*)$/;
  if (!timeZone || days.length !== 7 || !days.every((day) => spec.test(day)))
    throw new Error("Invalid market schedule.");
  new Intl.DateTimeFormat("en-US", { timeZone }); // throws on an unknown zone
  const map = new Map<string, string>();
  for (const entry of holidays.split(",").filter(Boolean)) {
    const [day, rule] = entry.split("/");
    if (!/^\d{4}$/.test(day) || !rule || !spec.test(rule))
      throw new Error("Invalid market schedule.");
    map.set(day, rule);
  }
  return { timeZone, weekly: days, holidays: map };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Regular when the feed's own schedule says the venue is open (holidays and half days included);
 * extended for the conventional 04:00–20:00 local window around it on a trading day; closed
 * otherwise. Extended hours are an approximation from the regular schedule, not a venue feed.
 */
export function marketSession(schedule: string, at: Date): MarketSession {
  let parsed: Schedule;
  try {
    parsed = parseSchedule(schedule);
  } catch {
    return "unknown";
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: parsed.timeZone,
      weekday: "short",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const weekday = WEEKDAYS.indexOf(parts.weekday);
  if (weekday < 0) return "unknown";
  const rule = parsed.holidays.get(`${parts.month}${parts.day}`) ?? parsed.weekly[weekday];
  if (rule === "O") return "regular";
  if (rule === "C") return "closed";
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
  for (const range of rule.split("&")) {
    const [start, end] = range.split("-").map(toMinutes);
    if (minute >= start && minute < end) return "regular";
  }
  return minute >= 4 * 60 && minute < 20 * 60 ? "extended" : "closed";
}

/** Reason the evidence cannot support a premium check at `quotedAtMs`, or null when usable. */
export function referenceGap(
  reference: BellReference | undefined,
  quotedAtMs: number,
): ReferenceGap | null {
  if (!reference || reference.status !== "available")
    return reference?.reason ?? "PROVIDER_UNAVAILABLE";
  if (reference.marketSession !== "regular") return "MARKET_NOT_REGULAR";
  const { price, multiplier } = reference;
  if (!price || !multiplier) return "PROVIDER_UNAVAILABLE";
  try {
    const value = BigInt(price.price),
      conf = BigInt(price.conf),
      numerator = BigInt(multiplier.numerator),
      denominator = BigInt(multiplier.denominator);
    if (value <= 0n || conf < 0n || !Number.isInteger(price.expo) || Math.abs(price.expo) > 18)
      return "PROVIDER_UNAVAILABLE";
    if (numerator <= 0n || denominator <= 0n) return "MULTIPLIER_UNAVAILABLE";
    const published = price.publishTime * 1000;
    if (
      !Number.isFinite(quotedAtMs) ||
      !Number.isSafeInteger(price.publishTime) ||
      published < quotedAtMs - REFERENCE_MAX_AGE_MS ||
      published > quotedAtMs + 5_000
    )
      return "STALE";
    if (conf * 10000n > value * REFERENCE_MAX_CONF_BPS) return "LOW_CONFIDENCE";
  } catch {
    return "PROVIDER_UNAVAILABLE";
  }
  return null;
}

interface PremiumInput {
  inAmount: string;
  minimumOutput: string;
  outputDecimals: number;
}

/**
 * The worst-case USD paid per share-equivalent, as a fraction, against a reference value
 * `priceUnits × 10^expo`. Worst case = input USDC ÷ (minimum tokens × multiplier).
 */
function premiumTerms(quote: PremiumInput, reference: BellReference, priceUnits: bigint) {
  const price = reference.price!,
    multiplier = reference.multiplier!;
  const scaleLeft = price.expo < 0 ? 10n ** BigInt(-price.expo) : 1n;
  const scaleRight = price.expo > 0 ? 10n ** BigInt(price.expo) : 1n;
  return {
    paid:
      BigInt(quote.inAmount) *
      10n ** BigInt(quote.outputDecimals) *
      BigInt(multiplier.denominator) *
      scaleLeft,
    reference:
      priceUnits *
      10n ** 6n *
      BigInt(quote.minimumOutput) *
      BigInt(multiplier.numerator) *
      scaleRight,
  };
}

/**
 * True when the worst-case price exceeds the reference by more than `maxPremiumBps`. The
 * reference used is the lower confidence bound, so uncertainty can only make Bell stricter.
 */
export function exceedsPremium(
  quote: PremiumInput,
  reference: BellReference,
  maxPremiumBps: number,
): boolean {
  const price = reference.price!;
  const lower = BigInt(price.price) - BigInt(price.conf);
  if (lower <= 0n) return true;
  const terms = premiumTerms(quote, reference, lower);
  return terms.paid * 10000n > terms.reference * BigInt(10000 + maxPremiumBps);
}

/** Signed worst-case premium over the reference mid price, in whole basis points (floored). */
export function premiumBps(quote: PremiumInput, reference: BellReference): bigint {
  const terms = premiumTerms(quote, reference, BigInt(reference.price!.price));
  const scaled = terms.paid * 10000n;
  let ratio = scaled / terms.reference;
  if (ratio * terms.reference > scaled) ratio -= 1n;
  return ratio - 10000n;
}
