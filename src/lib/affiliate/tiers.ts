import { env } from "@/lib/env";
import type { TierConfig, TierKey } from "./types";

export const TIER_CONFIG: Record<TierKey, TierConfig> = {
  "10": { discount: 10, commission: 20, dubGroupId: env.dubGroupIdTierA },
  "15": { discount: 15, commission: 15, dubGroupId: env.dubGroupIdTierB },
  "20": { discount: 20, commission: 10, dubGroupId: env.dubGroupIdTierC },
};

const LEGACY_TIER_PATTERN = /-(10|15|20)(?:-|$)/;

/** Returns tier key from discount code name, or null if not an affiliate code. */
export function parseTierFromCode(code: string): TierKey | null {
  const upper = code.toUpperCase();

  // Legacy dashed formats: STONEY-10-Y46R, STONEY-HARWARD-10
  const legacy = upper.match(LEGACY_TIER_PATTERN);
  if (legacy) {
    return legacy[1] as TierKey;
  }

  // Compact format: SH10, STONEY10
  if (upper.endsWith("20")) return "20";
  if (upper.endsWith("15")) return "15";
  if (upper.endsWith("10")) return "10";

  return null;
}

export function isAffiliateCode(code: string): boolean {
  return parseTierFromCode(code) !== null;
}

export function tierGroupId(tier: TierKey): string {
  return TIER_CONFIG[tier].dubGroupId();
}
