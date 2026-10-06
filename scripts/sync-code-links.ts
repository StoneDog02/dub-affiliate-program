/**
 * Align existing Dub link expiration with each affiliate's Shopify code status.
 * Dry run by default; pass --apply after deploying the coordinated toggle API.
 *
 *   npx tsx scripts/sync-code-links.ts
 *   npx tsx scripts/sync-code-links.ts --apply
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  changeCodeAvailability,
  PAUSED_LINK_EXPIRES_AT,
} from "@/lib/affiliate/code-availability";
import { getDubClient } from "@/lib/dub/client";
import { affiliateLinkForCode } from "@/lib/dub/partner-links";
import { listAllPartners, resolvePartnerMetadata } from "@/lib/dub/partners";
import { getDiscountByCode } from "@/lib/shopify/client";

for (const name of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), name);
  if (existsSync(path)) process.loadEnvFile(path);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const counts = { aligned: 0, needsPause: 0, needsRestore: 0, skipped: 0, failed: 0 };

  for (const partner of await listAllPartners()) {
    const metadata = resolvePartnerMetadata(partner);
    if (!metadata) {
      counts.skipped += 3;
      continue;
    }

    for (const tier of ["10", "15", "20"] as const) {
      const code = metadata[`code_${tier}`];
      try {
        const [discount, link] = await Promise.all([
          getDiscountByCode(code),
          affiliateLinkForCode({ ...partner, metadata }, code),
        ]);
        if (!discount) {
          counts.skipped += 1;
          continue;
        }

        const active = discount.codeDiscount.status === "ACTIVE";
        const aligned = active
          ? link.expiresAt === null
          : link.expiresAt === PAUSED_LINK_EXPIRES_AT;
        if (aligned) {
          counts.aligned += 1;
          continue;
        }

        if (active) counts.needsRestore += 1;
        else counts.needsPause += 1;

        if (apply) {
          await changeCodeAvailability({
            active,
            discountActive: active,
            linkExpiresAt: link.expiresAt,
            setDiscountActive: async () => {},
            setLinkExpiresAt: async (expiresAt) => {
              const updated = await getDubClient().links.update(link.id, { expiresAt });
              if (updated.expiresAt !== expiresAt) {
                throw new Error("Dub did not confirm the tracking link status change");
              }
            },
          });
        }
      } catch (error) {
        counts.failed += 1;
        console.error(`Link sync failed for partner ${partner.id}, tier ${tier}:`, error);
      }
    }
  }

  console.log(apply ? "Applied link sync:" : "Link sync dry run:", counts);
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
