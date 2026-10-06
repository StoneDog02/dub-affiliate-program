import assert from "node:assert/strict";
import test from "node:test";
import {
  commissionRateForSale,
  NEW_RATES_EFFECTIVE_AT,
} from "../src/lib/affiliate/commission-rates.ts";

const before = new Date(Date.parse(NEW_RATES_EFFECTIVE_AT) - 1).toISOString();

test("pre-change sales keep the prior rates", () => {
  assert.equal(commissionRateForSale("10", before, 25), 20);
  assert.equal(commissionRateForSale("15", before, 20), 15);
  assert.equal(commissionRateForSale("20", before, 15), 10);
});

test("sales from the cutover onward use the 35-point rates", () => {
  assert.equal(commissionRateForSale("10", NEW_RATES_EFFECTIVE_AT, 25), 25);
  assert.equal(commissionRateForSale("15", NEW_RATES_EFFECTIVE_AT, 20), 20);
  assert.equal(commissionRateForSale("20", NEW_RATES_EFFECTIVE_AT, 15), 15);
});
