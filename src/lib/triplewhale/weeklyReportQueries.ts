/**
 * Triple Whale Data-Out SQL for the Monday leadership report.
 *
 * Dates are Triple Whale parameters (@startDate / @endDate). The API `period`
 * supplies the values — do not interpolate dates into these strings.
 *
 * The Moby "Leadership – Weekly" SQL was not in the repo or this request.
 * Every table and column below is from Triple Whale's published docs
 * (orders_table, pixel_orders_table). Replace a query if the dashboard SQL
 * differs. Do not add columns that are not in that SQL.
 *
 * Column notes, where the dashboard wording does not match a column name:
 * - Autoship orders use `is_subscription_order`. There is no autoship column.
 * - New customers use `new_customer_orders` (orders placed by new customers).
 * - Affiliate partner uses `campaign_name`. `utm_campaign` is not a column on
 *   pixel_orders_table (it only exists inside sessions URL query JSON).
 * - AOV is computed in code from the documented formula:
 *   (order_revenue - shipping_price - taxes) / orders.
 */

export const ORDERS_SUMMARY_SQL = `
SELECT
  SUM(order_revenue) AS order_revenue,
  SUM(shipping_price) AS shipping_price,
  SUM(taxes) AS taxes,
  SUM(orders) AS orders,
  SUM(new_customer_orders) AS new_customer_orders,
  SUM(returning_customer_orders) AS returning_customer_orders,
  SUM(returning_customer_revenue) AS returning_customer_revenue
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
`.trim();

export const SUBSCRIPTION_ORDERS_SQL = `
SELECT
  SUM(orders) AS orders
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND is_subscription_order = true
`.trim();

export const PLATFORM_ORDERS_SQL = `
SELECT
  platform,
  SUM(order_revenue) AS order_revenue,
  SUM(orders) AS orders
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
GROUP BY platform
`.trim();

export const SOURCE_ORDERS_SQL = `
SELECT
  channel,
  utm_source,
  utm_medium,
  campaign_name,
  SUM(order_revenue) AS order_revenue,
  SUM(orders_quantity) AS orders_quantity
FROM pixel_orders_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND model = 'Triple Attribution'
GROUP BY channel, utm_source, utm_medium, campaign_name
`.trim();
