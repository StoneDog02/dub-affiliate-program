/**
 * Triple Whale Data-Out SQL for the Monday leadership report.
 *
 * One request covers both weeks. The API period starts on the prior Monday
 * and ends on the current Sunday (@startDate / @endDate). Each query groups
 * by event_date so the caller can split those rows into the two weeks.
 * Do not interpolate dates into the SQL.
 *
 * `orders`, `new_customer_orders`, `returning_customer_orders`, and
 * `returning_customer_revenue` are Moby formula fields, not ClickHouse columns
 * (Data Dictionary → Derived). Order counts use `order_id`. New vs returning
 * uses the `is_new_customer` boolean. Result aliases stay the same so the
 * report code does not change.
 */

export const ORDERS_SUMMARY_SQL = `
SELECT
  event_date,
  sum(order_revenue) AS order_revenue,
  sum(shipping_price) AS shipping_price,
  sum(taxes) AS taxes,
  count(distinct order_id) AS orders,
  count(distinct CASE WHEN is_new_customer THEN order_id END) AS new_customer_orders,
  count(distinct CASE WHEN NOT is_new_customer THEN order_id END) AS returning_customer_orders,
  sum(CASE WHEN NOT is_new_customer THEN order_revenue ELSE 0 END) AS returning_customer_revenue
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
GROUP BY event_date
`.trim();

export const SUBSCRIPTION_ORDERS_SQL = `
SELECT
  event_date,
  count(distinct order_id) AS orders
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND is_subscription_order = true
GROUP BY event_date
`.trim();

export const PLATFORM_ORDERS_SQL = `
SELECT
  event_date,
  platform,
  sum(order_revenue) AS order_revenue,
  count(distinct order_id) AS orders
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
GROUP BY event_date, platform
`.trim();

export const SOURCE_ORDERS_SQL = `
SELECT
  event_date,
  channel,
  utm_source,
  utm_medium,
  campaign_name,
  sum(order_revenue) AS order_revenue,
  sum(orders_quantity) AS orders_quantity
FROM pixel_orders_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND model = 'Triple Attribution'
GROUP BY event_date, channel, utm_source, utm_medium, campaign_name
`.trim();
