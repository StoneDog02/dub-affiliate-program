import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { buildDiscountCode, extractFirstName } from "@/lib/affiliate/codes";
import type { AffiliateMetadata } from "@/lib/affiliate/types";
import {
  createPartnerLink,
  getPartnerById,
  getPartnerMetadata,
  updatePartnerMetadata,
} from "@/lib/dub/partners";
import { env } from "@/lib/env";
import { sendAffiliateApprovedEmail } from "@/lib/klaviyo/client";
import { createDiscountCode } from "@/lib/shopify/client";
import { verifyDubWebhook } from "@/lib/utils/http";

type DubWebhookPayload = {
  event: string;
  data: {
    id: string;
    name: string;
    email: string;
    programId?: string;
  };
};

const TIERS = ["10", "15", "20"] as const;

/**
 * POST /api/webhooks/dub-partner-approved
 *
 * Fires when Dub approves/enrolls a new partner (partner.enrolled webhook).
 * Provisions Shopify discount codes, Dub tracking links, partner metadata, and Klaviyo event.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("Dub-Signature");

  if (!verifyDubWebhook(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: DubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as DubWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.event !== "partner.enrolled") {
    return NextResponse.json({ ok: true, skipped: true, event: payload.event });
  }

  const { id: partnerId, name, email } = payload.data;
  if (!partnerId || !email) {
    return NextResponse.json({ error: "Missing partner id or email" }, { status: 400 });
  }

  const programId = env.dubProgramId();
  if (payload.data.programId && payload.data.programId !== programId) {
    return NextResponse.json({ ok: true, skipped: true, reason: "program_mismatch" });
  }

  try {
    const existing = await getPartnerById(partnerId);
    if (existing && getPartnerMetadata(existing)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "already_provisioned" });
    }

    const token = randomUUID();
    const firstName = extractFirstName(name);
    const metadata: AffiliateMetadata = {
      token,
      code_10: "",
      link_10: "",
      code_15: "",
      link_15: "",
      code_20: "",
      link_20: "",
    };

    for (const tier of TIERS) {
      const code = buildDiscountCode(name, tier);
      const discount = Number(tier);
      const destination = `${env.portalBaseUrl()}/discount/${code}`;

      await createDiscountCode(code, discount);
      const link = await createPartnerLink(partnerId, code, destination);

      if (tier === "10") {
        metadata.code_10 = code;
        metadata.link_10 = link;
      } else if (tier === "15") {
        metadata.code_15 = code;
        metadata.link_15 = link;
      } else {
        metadata.code_20 = code;
        metadata.link_20 = link;
      }
    }

    await updatePartnerMetadata({ email, name }, metadata);

    const portalUrl = `${env.portalBaseUrl()}/pages/affiliate-portal?token=${token}`;
    await sendAffiliateApprovedEmail({
      firstName,
      email,
      portalUrl,
      metadata,
    });

    return NextResponse.json({ ok: true, partnerId, token });
  } catch (error) {
    console.error("[dub-partner-approved]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Provisioning failed" },
      { status: 500 },
    );
  }
}
