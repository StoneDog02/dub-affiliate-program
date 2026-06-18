import { env } from "@/lib/env";
import type { TierConfig, TierKey } from "./types";

export const TIER_CONFIG: Record<TierKey, TierConfig> = {
  "10": { discount: 10, commission: 20, dubGroupId: env.dubGroupIdTierA },
  "15": { discount: 15, commission: 15, dubGroupId: env.dubGroupIdTierB },
  "20": { discount: 20, commission: 10, dubGroupId: env.dubGroupIdTierC },
};

const CODE_PATTERN = /-(10|15|20)-/;

/** Returns tier key from discount code name, or null if not an affiliate code. */
export function parseTierFromCode(code: string): TierKey | null {
  const normalized = code.toUpperCase();
  if (normalized.includes("-10-")) return "10";
  if (normalized.includes("-15-")) return "15";
  if (normalized.includes("-20-")) return "20";
  return null;
}

export function isAffiliateCode(code: string): boolean {
  return CODE_PATTERN.test(code.toUpperCase());
}

export function tierGroupId(tier: TierKey): string {
  return TIER_CONFIG[tier].dubGroupId();
}
