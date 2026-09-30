/**
 * CareValidate PAYMENT_COMPLETED  ->  Triple Whale Data-In (Create Order Record)
 *
 * Call `forwardToTripleWhale(body)` from the existing POST /api/webhooks/carevalidate
 * handler, after the Dub step. It never throws, so a Triple Whale outage can't break
 * the Dub sale or the webhook acknowledgement.
 *
 * PRIVACY (minimum necessary): Triple Whale is not a HIPAA business associate, so this
 * sends NO direct patient identifiers and NO clinical detail.
 *   Sent:     payment id, amount, payment date, a generic program category, promo/referral
 *             code, patient STATE (state-level geography only), and a keyed pseudonymous
 *             customer id so Triple Whale can count new vs. returning customers and LTV.
 *   NOT sent: name, email, phone, DOB, gender, street/city/ZIP, medication or bundle names
 *             (payment.description, productBundle.name), case title, fees breakdown,
 *             activity text (contains card last-4), actor/creator details.
 * Have compliance sign off on this field list before enabling in production.
 *
 * Env vars:
 *   TRIPLEWHALE_API_KEY      Triple Whale API key with Data-In scope
 *   TRIPLEWHALE_SHOP_ID      defaults to "bodyiqhealth.myshopify.com"
 *   TW_PSEUDONYM_SECRET      long random secret for the keyed customer hash; store like a
 *                            password and never change it (changing it resets customer history)
 *   TW_TELEHEALTH_ENABLED    set to "true" to actually send; anything else = dry run (logs only)
 */
import crypto from "node:crypto";

const TW_ORDERS_URL = "https://api.triplewhale.com/api/v2/data-in/orders";
const SHOP = process.env.TRIPLEWHALE_SHOP_ID ?? "bodyiqhealth.myshopify.com";

// Generic, non-clinical labels by CareValidate case.type. Add types as they appear.
const CATEGORY_LABELS: Record<string, string> = {
  GLP: "Telehealth – Weight Loss",
};
const DEFAULT_CATEGORY = "Telehealth Program";

// Open webhook object: documented fields plus undocumented promo fallbacks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function categoryFor(caseType: unknown): { id: string; label: string } {
  const type = typeof caseType === "string" && caseType.trim() ? caseType.trim().toUpperCase() : "OTHER";
  return { id: `telehealth-${type.toLowerCase()}`, label: CATEGORY_LABELS[type] ?? DEFAULT_CATEGORY };
}

/** Keyed hash (HMAC), not a plain hash: a plain SHA of an id/email can be reversed by lookup. */
function pseudonymousCustomerId(submitterId: string): string {
  const secret = process.env.TW_PSEUDONYM_SECRET;
  if (!secret) throw new Error("TW_PSEUDONYM_SECRET is not set");
  return crypto.createHmac("sha256", secret).update(String(submitterId)).digest("hex").slice(0, 32);
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString(); // always UTC "Z", as TW requires a timezone
}

/** Same promo lookup as the Dub step: documented field first, then the undocumented fallbacks. */
function referralCodeFrom(c: Json | undefined): string | null {
  const raw =
    c?.referralCode ??
    c?.promoCode ??
    (Array.isArray(c?.promoCodes) ? c.promoCodes.find((x: unknown) => typeof x === "string" && x.trim()) : null);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** Returns the Triple Whale order body, or null if this event should be skipped. */
export function buildTripleWhaleOrder(body: Json): Json | null {
  if (body?.event !== "PAYMENT_COMPLETED") return null;

  const payment: Json | undefined = body?.payload?.payment;
  const kase: Json | undefined = body?.payload?.case;
  if (!payment?.id || payment.isDeleted || payment.status !== "PAID") return null;

  const amount = Number.parseFloat(String(payment.amount));
  if (!Number.isFinite(amount) || amount < 0) return null;

  const submitterId = kase?.submitter?.id;
  const createdAt = toIso(payment.paymentDate ?? payment.createdAt);
  if (!submitterId || !createdAt) return null;

  const customerId = pseudonymousCustomerId(submitterId);
  const category = categoryFor(kase?.type);
  const code = referralCodeFrom(kase);
  const state = typeof kase?.submitter?.state === "string" ? kase.submitter.state.trim().toUpperCase() : null;

  const order: Json = {
    shop: SHOP,
    order_id: `cv_${payment.id}`, // matches the Dub sale id, so both systems line up
    platform: "carevalidate",
    platform_account_id: "carevalidate",
    created_at: createdAt,
    currency: "USD",
    // TW requires customer.id + (email or phone). The email is a non-deliverable placeholder
    // derived from the pseudonymous id (".invalid" is a reserved TLD), not the patient's email.
    customer: { id: customerId, email: `${customerId}@patients.invalid` },
    order_revenue: amount,
    line_items: [{ id: category.id, product_id: category.id, name: category.label, price: amount, quantity: 1 }],
    source_name: "telehealth",
    tags: ["telehealth", "carevalidate", category.id],
    status: "completed",
  };
  if (code) {
    order.discount_codes = [{ code }];
    order.tags.push("referral");
  }
  if (state) order.shipping_address = { province_code: state, country_code: "US" };
  return order;
}

/** Sends the order. Never throws; logs contain no patient data. */
export async function forwardToTripleWhale(body: Json): Promise<void> {
  let order: Json | null = null;
  try {
    order = buildTripleWhaleOrder(body);
  } catch (err) {
    console.error("[tw-telehealth] build failed:", (err as Error).message);
    return;
  }
  if (!order) return;

  if (process.env.TW_TELEHEALTH_ENABLED !== "true") {
    console.log("[tw-telehealth] dry run", { order_id: order.order_id, revenue: order.order_revenue, category: order.line_items[0].id, has_code: Boolean(order.discount_codes) });
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(TW_ORDERS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.TRIPLEWHALE_API_KEY ?? "" },
        body: JSON.stringify(order),
      });
      if (res.ok) {
        console.log("[tw-telehealth] sent", order.order_id);
        return;
      }
      // 400 = bad payload: retrying won't help. 429/5xx: back off and retry.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        console.error("[tw-telehealth] rejected", order.order_id, res.status, (await res.text()).slice(0, 300));
        return;
      }
      console.warn("[tw-telehealth] retryable", order.order_id, res.status);
    } catch (err) {
      console.warn("[tw-telehealth] network error", order.order_id, (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  console.error("[tw-telehealth] gave up", order.order_id);
}
