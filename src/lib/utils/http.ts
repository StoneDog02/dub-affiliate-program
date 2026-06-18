import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export function verifyDubWebhook(rawBody: string, signature: string | null): boolean {
  const secret = process.env.DUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(computed, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null,
): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;

  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  try {
    return timingSafeEqual(
      Buffer.from(computed, "utf8"),
      Buffer.from(hmacHeader, "utf8"),
    );
  } catch {
    return false;
  }
}

const PORTAL_ORIGIN = process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? "https://bodyiq.com";

export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": PORTAL_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function jsonWithCors(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

export function optionsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export function extractFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
