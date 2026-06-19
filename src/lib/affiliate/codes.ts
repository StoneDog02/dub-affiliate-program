import type { TierKey } from "./types";

export function extractFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "AFFILIATE";
  return first.replace(/[^a-zA-Z]/g, "").toUpperCase() || "AFFILIATE";
}

function nameParts(fullName: string): string[] {
  return fullName
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean);
}

/** First name, or first+last initials when the name has multiple parts (e.g. STONEY or SH). */
export function buildCodePrefix(fullName: string): string {
  const parts = nameParts(fullName);

  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }

  return extractFirstName(fullName);
}

/** Compact affiliate code — e.g. SH10 or STONEY10 (no dashes, no random suffix). */
export function buildDiscountCode(fullName: string, tier: TierKey): string {
  return `${buildCodePrefix(fullName)}${tier}`;
}
