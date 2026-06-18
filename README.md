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
  → Fire Klaviyo affiliate_approved event

Shopify order paid (webhook)
  → Parse tier from code name (-10- / -15- / -20-)
  → Move partner to correct Dub group BEFORE commission fires

Affiliate portal (Shopify page)
  → GET /api/affiliate/me?token=...
  → POST /api/affiliate/toggle-code
```

### Tier mapping

| Code pattern | Customer discount | Affiliate commission | Dub group env |
|---|---|---|---|
| `-10-` | 10% | 20% | `DUB_GROUP_ID_TIER_A` |
| `-15-` | 15% | 15% | `DUB_GROUP_ID_TIER_B` |
| `-20-` | 20% | 10% | `DUB_GROUP_ID_TIER_C` |

## Environment variables

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `SHOPIFY_ADMIN_API_KEY` | Shopify Admin API access token |
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

## API routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/webhooks/dub-partner-approved` | Provision codes + links on Dub `partner.enrolled` |
| `POST` | `/api/webhooks/shopify-order-complete` | Move partner to tier group on order |
| `GET` | `/api/affiliate/me?token=` | Portal data + Shopify code status |
| `POST` | `/api/affiliate/toggle-code` | Enable/disable a discount code |

## Shopify setup

1. **Deploy** this Next.js app (e.g. Vercel) and set all env vars.
2. **Webhook — Dub**: point to `https://[your-api]/api/webhooks/dub-partner-approved`, subscribe to `partner.enrolled`.
3. **Webhook — Shopify**: point to `https://[your-api]/api/webhooks/shopify-order-complete`, topic `orders/paid`.
4. **Portal page**: create a Shopify page at `/pages/affiliate-portal`, assign template `page.affiliate-portal`.
5. Copy `shopify/templates/page.affiliate-portal.liquid` into your theme.
6. Add a theme setting `affiliate_api_base` (type: text) or update the default API URL in the template.

## Dub partner metadata

Stored on each partner via the Dub API (serialized in partner `description`, indexed by `tenantId = token`):

```json
{
  "token": "[UUID]",
  "code_10": "ASHLEY-10-K7M2",
  "link_10": "https://bodyiq.dub.link/ASHLEY-10-K7M2",
  "code_15": "ASHLEY-15-X3P9",
  "link_15": "https://bodyiq.dub.link/ASHLEY-15-X3P9",
  "code_20": "ASHLEY-20-R4N8",
  "link_20": "https://bodyiq.dub.link/ASHLEY-20-R4N8"
}
```

## Development

```bash
npm install
npm run dev
```

## License

Private — BodyiQ internal use.
