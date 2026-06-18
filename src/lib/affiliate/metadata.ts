import type { AffiliateMetadata } from "./types";

/** Prefix stored in Dub partner description to persist affiliate metadata as JSON. */
export const METADATA_PREFIX = "BODYIQ_AFFILIATE_METADATA::";

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
