import type { AffiliateMetadata } from "@/lib/affiliate/types";
import { metadataCodes } from "@/lib/affiliate/metadata";
import { getDubClient, type DubPartner } from "./client";

/** Resolve only the link that was provisioned for this partner and code. */
export async function affiliateLinkForCode(
  partner: DubPartner & { metadata: AffiliateMetadata },
  code: string,
) {
  const tierIndex = metadataCodes(partner.metadata).indexOf(code);
  const tier = (["10", "15", "20"] as const)[tierIndex];
  if (!tier) throw new Error("Affiliate code has no matching tier");

  const expectedShortLink = partner.metadata[`link_${tier}`];
  const shortLinkUrl = new URL(expectedShortLink);
  if (shortLinkUrl.protocol !== "https:" || shortLinkUrl.pathname !== `/${code}`) {
    throw new Error("Affiliate tracking link does not match its code");
  }
  const partnerId = partner.partnerId || partner.id;
  const link = await getDubClient().links.get({ domain: shortLinkUrl.host, key: code });
  if (
    link.partnerId !== partnerId ||
    link.shortLink !== expectedShortLink ||
    link.key !== code
  ) {
    throw new Error("Dub tracking link does not belong to this affiliate");
  }
  if (link.archived || link.disabledAt) {
    throw new Error("Dub tracking link is archived or disabled");
  }
  return link;
}
