import { randomBytes } from "crypto";

const RANDOM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function extractFirstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "AFFILIATE";
  return first.replace(/[^a-zA-Z]/g, "").toUpperCase() || "AFFILIATE";
}

export function randomSuffix(length = 4): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += RANDOM_CHARS[bytes[i]! % RANDOM_CHARS.length];
  }
  return result;
}

export function buildDiscountCode(firstName: string, tier: "10" | "15" | "20"): string {
  return `${extractFirstName(firstName)}-${tier}-${randomSuffix()}`;
}
