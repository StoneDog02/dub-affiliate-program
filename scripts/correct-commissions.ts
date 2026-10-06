/**
 * Move every approved partner into the 25% home group, then correct unpaid
 * Dub sale commissions from the last 90 days. Prints paid rows that are wrong
 * and leaves them unchanged.
 *
 * Run once after the earnings corrector is deployed, before the next payout.
 * Loads .env.local itself:
 *   npx tsx scripts/correct-commissions.ts
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  reconcileSalesSince,
  type CorrectionRow,
} from "@/lib/dub/commission-corrections";
import { moveAllPartnersToHomeGroup } from "@/lib/dub/partners";

const LOOKBACK_DAYS = 90;

function loadLocalEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (existsSync(path)) {
      process.loadEnvFile(path);
    }
  }
}

function dollars(cents: number | undefined): string {
  if (cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

function printRow(row: CorrectionRow): void {
  console.log(
    [
      row.action,
      row.invoiceId,
      row.partnerName ?? "",
      row.partnerEmail ?? "",
      row.key ?? "",
      row.source ?? "",
      dollars(row.amount),
      dollars(row.earnings),
      dollars(row.targetEarnings),
      row.status ?? "",
    ].join("\t"),
  );
}

async function main(): Promise<void> {
  loadLocalEnv();

  const groups = await moveAllPartnersToHomeGroup();
  console.log(
    `Partners moved to the 25% group: ${groups.moved}. Already there: ${groups.unchanged}.`,
  );

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await reconcileSalesSince(since);
  const notable = rows.filter(
    (row) => row.action === "patched" || row.action === "paid_mismatch",
  );

  console.log(
    "action\tinvoiceId\tpartner\temail\tkey\tsource\tsale\tearings\ttarget\tstatus",
  );
  for (const row of notable) {
    printRow(row);
  }

  const patched = rows.filter((row) => row.action === "patched").length;
  const paid = rows.filter((row) => row.action === "paid_mismatch").length;
  const unchanged = rows.filter((row) => row.action === "unchanged").length;
  console.log(
    `Sales checked: ${rows.length}. Patched: ${patched}. Unchanged: ${unchanged}. Paid mismatches left as-is: ${paid}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
