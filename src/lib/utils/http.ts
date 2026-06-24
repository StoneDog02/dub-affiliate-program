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

/**
 * Optional shared-secret check for inbound CareValidate webhooks.
 * When CAREVALIDATE_WEBHOOK_SECRET is set, the request must include the same
 * value in `x-webhook-secret` or `x-carevalidate-webhook-secret`.
 */
export function verifyCareValidateWebhook(req: Request): boolean {
  const secret = process.env.CAREVALIDATE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return true;
  }

  const headerSecret =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-carevalidate-webhook-secret");

  if (!headerSecret) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(secret, "utf8"),
      Buffer.from(headerSecret, "utf8"),
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

const PORTAL_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? "https://bodyiq.com",
  "https://bodyiq.com",
  "https://www.bodyiq.com",
]);

function portalOrigin(request?: Request): string {
  const origin = request?.headers.get("Origin");
  if (origin && PORTAL_ORIGINS.has(origin)) {
    return origin;
  }
  return process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? "https://bodyiq.com";
}

export function corsHeaders(request?: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": portalOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function jsonWithCors(
  body: unknown,
  status = 200,
  request?: Request,
): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

export function optionsResponse(request?: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function extractFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
