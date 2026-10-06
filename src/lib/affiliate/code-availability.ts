/** A recognizable expiration used only when an affiliate pauses a link. */
export const PAUSED_LINK_EXPIRES_AT = "2000-01-01T00:00:00.000Z";

type AvailabilityChange = {
  active: boolean;
  discountActive: boolean;
  linkExpiresAt: string | null;
  setDiscountActive: (active: boolean) => Promise<void>;
  setLinkExpiresAt: (expiresAt: string | null) => Promise<void>;
};

/** Keep the Shopify discount and its Dub link in step, restoring both on failure. */
export async function changeCodeAvailability(input: AvailabilityChange): Promise<void> {
  const { active, discountActive, linkExpiresAt, setDiscountActive, setLinkExpiresAt } = input;
  if (linkExpiresAt !== null && linkExpiresAt !== PAUSED_LINK_EXPIRES_AT) {
    throw new Error("This tracking link has a separate expiration; update it in Dub first");
  }

  const targetExpiration = active ? null : PAUSED_LINK_EXPIRES_AT;
  let discountAttempted = false;
  let linkAttempted = false;

  try {
    if (active) {
      // A working code must precede a working referral link.
      if (!discountActive) {
        discountAttempted = true;
        await setDiscountActive(true);
      }
      if (linkExpiresAt !== targetExpiration) {
        linkAttempted = true;
        await setLinkExpiresAt(targetExpiration);
      }
    } else {
      // Stop new attributed clicks before deactivating the code.
      if (linkExpiresAt !== targetExpiration) {
        linkAttempted = true;
        await setLinkExpiresAt(targetExpiration);
      }
      if (discountActive) {
        discountAttempted = true;
        await setDiscountActive(false);
      }
    }
  } catch (error) {
    const rollback = await Promise.allSettled([
      ...(discountAttempted ? [setDiscountActive(discountActive)] : []),
      ...(linkAttempted ? [setLinkExpiresAt(linkExpiresAt)] : []),
    ]);
    if (rollback.some((result) => result.status === "rejected")) {
      throw new Error("Code and link update failed; the previous state could not be fully restored", {
        cause: error,
      });
    }
    throw error;
  }
}
