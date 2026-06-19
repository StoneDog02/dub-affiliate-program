import type { AffiliateMetadata, TierKey } from "./types";

/** Prefix stored in Dub partner description to persist affiliate metadata as JSON. */
export const METADATA_PREFIX = "BODYIQ_AFFILIATE_METADATA::";

const TIERS: TierKey[] = ["10", "15", "20"];

type PartnerLinks = Array<{ key?: string | null; shortLink?: string | null }> | null | undefined;

export function serializeMetadata(metadata: AffiliateMetadata): string {
  return `${METADATA_PREFIX}${JSON.stringify(metadata)}`;
}

export function parseMetadataFromDescription(
  description: string | null | undefined,
): AffiliateMetadata | null {
  if (!description?.startsWith(METADATA_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(
      description.slice(METADATA_PREFIX.length),
    ) as AffiliateMetadata;
  } catch {
    return null;
  }
}

export function metadataCodes(metadata: AffiliateMetadata): string[] {
  return [metadata.code_10, metadata.code_15, metadata.code_20];
}

export function metadataIncludesCode(
  metadata: AffiliateMetadata,
  code: string,
): boolean {
  return metadataCodes(metadata).includes(code);
}

/** Rebuild metadata from tenantId + tier links when Dub drops description on upsert. */
export function reconstructMetadataFromLinks(
  token: string,
  links: PartnerLinks,
): AffiliateMetadata | null {
  const metadata: AffiliateMetadata = {
    token,
    code_10: "",
    link_10: "",
    code_15: "",
    link_15: "",
    code_20: "",
    link_20: "",
  };

  for (const link of links ?? []) {
    const key = link.key ?? "";
    for (const tier of TIERS) {
      if (key.includes(`-${tier}-`)) {
        metadata[`code_${tier}`] = key;
        metadata[`link_${tier}`] = link.shortLink ?? "";
      }
    }
  }

  if (!metadata.code_10 || !metadata.code_15 || !metadata.code_20) {
    return null;
  }

  return metadata;
}
