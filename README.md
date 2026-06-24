# BodyiQ Affiliate Program Backend

Lightweight affiliate management layer for [BodyiQ](https://bodyiq.com), built on Next.js with **no external database**. All affiliate identity and code/link state lives in **Dub partner metadata**; Shopify Admin API is the source of truth for discount code active/inactive status.

## Stack

- **Next.js** — API routes (webhooks + affiliate portal APIs)
- **Dub** — partner tracking, analytics, commissions, payouts
- **Shopify** — discount codes + affiliate portal page (Liquid template)
- **Klaviyo** — welcome email on affiliate approval

## Architecture

```
Dub partner approved (webhook)
  → Create 3 Shopify discount codes (10% / 15% / 20%)
  → Create 3 Dub tracking links → bodyiq.com/discount/[CODE]
  → Store metadata on Dub partner record
  → Tag matching Shopify customer + store portal token metafield
  → Fire Klaviyo affiliate_approved event
  → Manual: create same 3 promo codes in CareValidate admin

Shopify customer created (webhook)
  → If email matches a Dub affiliate, tag customer + store portal token

Shopify order paid (webhook)
  → Parse tier from code suffix (e.g. SH10, STONEY10)
  → Move partner to correct Dub group BEFORE commission fires

CareValidate payment completed (webhook)
  → Read affiliate promo from payload (case.referralCode)
  → Move partner to correct Dub tier group
  → Record sale commission in Dub (commissions.create)

Affiliate portal (Shopify page, login required)
  → Token read from customer metafield (custom.affiliate_portal_token)
  → GET /api/affiliate/me?token=...
  → POST /api/affiliate/toggle-code
```

### Tier mapping

| Code pattern | Customer discount | Affiliate commission | Dub group env |
|---|---|---|---|
| `10` suffix | 10% | 20% | `DUB_GROUP_ID_TIER_A` |
| `15` suffix | 15% | 15% | `DUB_GROUP_ID_TIER_B` |
| `20` suffix | 20% | 10% | `DUB_GROUP_ID_TIER_C` |

## Environment variables

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `SHOPIFY_CLIENT_ID` | Dev Dashboard app Client ID |
| `SHOPIFY_CLIENT_SECRET` | Dev Dashboard app Secret (exchanged for access tokens) |
| `SHOPIFY_STORE_DOMAIN` | e.g. `bodyiq.myshopify.com` |
| `SHOPIFY_WEBHOOK_SECRET` | HMAC secret for order webhooks |
| `DUB_API_KEY` | Dub workspace API key |
| `DUB_PROGRAM_ID` | Dub partner program ID |
| `DUB_WEBHOOK_SECRET` | Dub webhook signing secret |
| `DUB_GROUP_ID_TIER_A` | Group for 20% commission |
| `DUB_GROUP_ID_TIER_B` | Group for 15% commission |
| `DUB_GROUP_ID_TIER_C` | Group for 10% commission |
| `KLAVIYO_API_KEY` | Klaviyo private API key |
| `NEXT_PUBLIC_PORTAL_BASE_URL` | `https://bodyiq.com` |
| `NEXT_PUBLIC_API_BASE_URL` | Deployed Next.js URL (for Shopify portal JS) |
| `DUB_PARTNER_PORTAL_URL` | Optional, defaults to `https://partners.dub.co` |
| `DUB_LINK_DOMAIN` | Optional, defaults to `bodyiq.dub.link` |
| `CAREVALIDATE_INTAKE_BASE_URL` | Patient intake entry, e.g. `https://intake.bodyiq.com` |
| `CAREVALIDATE_WEBHOOK_SECRET` | Optional shared secret; require `x-webhook-secret` header on CV webhooks |

## CareValidate clinical flow

CareValidate does not expose a promo create API. On each new affiliate approval:

1. **Shopify + Dub** — provisioned automatically by the approval webhook.
2. **CareValidate** — manually create the same three code strings in **Promo Codes** admin (10% / 15% / 20% patient discount).
3. **Patient** — enters code at `intake.bodyiq.com` `/payment` (manual entry until URL persistence is fixed).
4. **Commission** — `PAYMENT_COMPLETED` webhook → `POST /api/webhooks/carevalidate` → Dub `commissions.create`.

Register the webhook in CareValidate admin (**Settings → API → Webhooks**):

```
https://[your-api]/api/webhooks/carevalidate
```

Subscribe to **PAYMENT_COMPLETED**. Confirm with CareValidate that the promo used at payment appears in `payload.case.referralCode` (or ask which field to use).

If `CAREVALIDATE_WEBHOOK_SECRET` is set, CareValidate must send the same value in the `x-webhook-secret` request header (configure if their admin supports custom headers).

## API routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/webhooks/dub-partner-approved` | Provision codes + links on Dub `partner.enrolled` |
| `POST` | `/api/webhooks/shopify-order-complete` | Move partner to tier group on order |
| `POST` | `/api/webhooks/shopify-customer-created` | Link new Shopify customer to Dub affiliate |
| `POST` | `/api/webhooks/carevalidate` | Record Dub commission on CV `PAYMENT_COMPLETED` |
| `GET` | `/api/affiliate/me?token=` | Portal data + Shopify code status |
| `POST` | `/api/affiliate/toggle-code` | Enable/disable a discount code |

## Shopify setup

1. **Deploy** this Next.js app (e.g. Vercel) and set all env vars.
2. **Shopify app scopes**: ensure your Dev Dashboard app includes `write_customers` (for affiliate tagging + metafields).
3. **Customer metafield** (Settings → Custom data → Customers):
   - Name: `Affiliate portal token`
   - Namespace and key: `custom.affiliate_portal_token`
   - Type: Single line text
   - Storefront access: **Read** (required for theme Liquid)
4. **Webhook — Dub**: point to `https://[your-api]/api/webhooks/dub-partner-approved`, subscribe to `partner.enrolled`.
5. **Webhook — Shopify**: point to `https://[your-api]/api/webhooks/shopify-order-complete`, topic `orders/paid`.
6. **Webhook — Shopify**: point to `https://[your-api]/api/webhooks/shopify-customer-created`, topic `customers/create`.
7. **Webhook — CareValidate**: point to `https://[your-api]/api/webhooks/carevalidate`, event `PAYMENT_COMPLETED`.
8. **Portal page**: create a Shopify page at `/pages/affiliate-portal`, assign template `page.affiliate-portal`.
9. Copy `shopify/templates/page.affiliate-portal.liquid` into your theme.
10. Copy `shopify/snippets/affiliate-portal-nav.liquid` into your theme and add `{% render 'affiliate-portal-nav' %}` to your header/nav.
11. Copy `shopify/templates/page.affiliates.liquid` and create a Shopify page with handle `affiliates`, template `page.affiliates`.
12. Copy `shopify/snippets/become-affiliate-footer-link.liquid` and add `{% render 'become-affiliate-footer-link' %}` to your theme footer.
13. Add theme settings from `shopify/config/settings_schema.snippet.json` (`affiliate_api_base`, `affiliate_apply_url`) or update defaults in the templates.
14. Optional: add a URL redirect from `/affiliates` → `/pages/affiliates` in Shopify Admin → Online Store → Navigation → URL Redirects.

### Affiliate portal access

Affiliates must **log in** to bodyiq.com with the same email as their Dub partner account. On approval (or on first customer registration), the backend:

- Adds customer tag `affiliate`
- Sets metafield `custom.affiliate_portal_token` to their Dub portal token

The portal page reads that metafield server-side. The nav snippet only renders for logged-in tagged customers. Welcome emails should link to `/pages/affiliate-portal` (login required — no token in the URL).

**Existing affiliates** approved before this change need a one-time sync: ensure a Shopify customer exists with their email, then re-run provisioning or manually set the tag + metafield.

## Dub partner metadata

Stored on each partner via the Dub API (serialized in partner `description`, indexed by `tenantId = token`):

```json
{
  "token": "[UUID]",
  "code_10": "SH10",
  "link_10": "https://bodyiq.dub.link/SH10",
  "code_15": "SH15",
  "link_15": "https://bodyiq.dub.link/SH15",
  "code_20": "SH20",
  "link_20": "https://bodyiq.dub.link/SH20"
}
```

## Development

```bash
npm install
npm run dev
```

## License

Private — BodyiQ internal use.
