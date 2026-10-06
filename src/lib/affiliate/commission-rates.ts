import type { TierKey } from "./types";

export const NEW_RATES_EFFECTIVE_AT = "2026-10-06T19:47:29Z";

const PREVIOUS_COMMISSIONS: Record<TierKey, number> = {
  "10": 20,
  "15": 15,
  "20": 10,
};

/** Preserve prior earnings when the reconciliation job revisits older sales. */
export function commissionRateForSale(
  tier: TierKey,
  saleCreatedAt: string | undefined,
  currentRate: number,
): number {
  const createdAt = saleCreatedAt ? Date.parse(saleCreatedAt) : NaN;
  return Number.isFinite(createdAt) && createdAt < Date.parse(NEW_RATES_EFFECTIVE_AT)
    ? PREVIOUS_COMMISSIONS[tier]
    : currentRate;
}
