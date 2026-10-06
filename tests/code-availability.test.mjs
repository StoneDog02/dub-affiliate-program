import assert from "node:assert/strict";
import test from "node:test";
import {
  changeCodeAvailability,
  PAUSED_LINK_EXPIRES_AT,
} from "../src/lib/affiliate/code-availability.ts";

function fixture(discountActive, linkExpiresAt) {
  const calls = [];
  const state = { discountActive, linkExpiresAt };
  return {
    calls,
    state,
    input: {
      discountActive,
      linkExpiresAt,
      setDiscountActive: async (active) => {
        calls.push(`shopify:${active}`);
        state.discountActive = active;
      },
      setLinkExpiresAt: async (expiresAt) => {
        calls.push(`dub:${expiresAt}`);
        state.linkExpiresAt = expiresAt;
      },
    },
  };
}

test("pausing expires the link before disabling the discount", async () => {
  const f = fixture(true, null);
  await changeCodeAvailability({ ...f.input, active: false });
  assert.deepEqual(f.calls, [`dub:${PAUSED_LINK_EXPIRES_AT}`, "shopify:false"]);
  assert.deepEqual(f.state, {
    discountActive: false,
    linkExpiresAt: PAUSED_LINK_EXPIRES_AT,
  });
});

test("reactivating enables the discount before the link", async () => {
  const f = fixture(false, PAUSED_LINK_EXPIRES_AT);
  await changeCodeAvailability({ ...f.input, active: true });
  assert.deepEqual(f.calls, ["shopify:true", "dub:null"]);
  assert.deepEqual(f.state, { discountActive: true, linkExpiresAt: null });
});

test("a failed Shopify update restores an expired link", async () => {
  const f = fixture(true, null);
  f.input.setDiscountActive = async (active) => {
    f.calls.push(`shopify:${active}`);
    if (!active) throw new Error("Shopify unavailable");
    f.state.discountActive = active;
  };
  await assert.rejects(
    changeCodeAvailability({ ...f.input, active: false }),
    /Shopify unavailable/,
  );
  assert.deepEqual(f.state, { discountActive: true, linkExpiresAt: null });
});

test("a failed Dub update restores an activated discount", async () => {
  const f = fixture(false, PAUSED_LINK_EXPIRES_AT);
  f.input.setLinkExpiresAt = async (expiresAt) => {
    f.calls.push(`dub:${expiresAt}`);
    if (expiresAt === null) throw new Error("Dub unavailable");
    f.state.linkExpiresAt = expiresAt;
  };
  await assert.rejects(
    changeCodeAvailability({ ...f.input, active: true }),
    /Dub unavailable/,
  );
  assert.deepEqual(f.state, {
    discountActive: false,
    linkExpiresAt: PAUSED_LINK_EXPIRES_AT,
  });
});

test("an unrelated link expiration is preserved", async () => {
  const f = fixture(true, "2030-01-01T00:00:00.000Z");
  await assert.rejects(
    changeCodeAvailability({ ...f.input, active: false }),
    /separate expiration/,
  );
  assert.deepEqual(f.calls, []);
});

test("an already inactive Shopify code pauses its still-active link", async () => {
  const f = fixture(false, null);
  await changeCodeAvailability({ ...f.input, active: false });
  assert.deepEqual(f.calls, [`dub:${PAUSED_LINK_EXPIRES_AT}`]);
});

test("repeating a completed toggle makes no external updates", async () => {
  const f = fixture(false, PAUSED_LINK_EXPIRES_AT);
  await changeCodeAvailability({ ...f.input, active: false });
  assert.deepEqual(f.calls, []);
});
