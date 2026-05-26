import { describe, expect, it, vi } from "vitest";

import { auditIdentityRows } from "./security-audit-identities";

const row = {
  id: "user-1",
  privy_user_id: "did:privy:user:1",
  wallet_address: "0xwrong",
  email: "wrong@example.com",
  telegram_id: "123",
};

describe("auditIdentityRows", () => {
  it("reports deterministic mismatches and Telegram manual review without updating", async () => {
    const update = vi.fn();
    const result = await auditIdentityRows(
      [row],
      async () => ({ walletAddress: "0xcanonical", email: "right@example.com" }),
      update,
      false,
    );

    expect(result.findings.map((finding) => finding.type)).toEqual([
      "wallet_mismatch",
      "email_mismatch",
      "telegram_manual_review",
    ]);
    expect(update).not.toHaveBeenCalled();
    expect(result.manualReviewCount).toBe(1);
  });

  it("applies only deterministic identity corrections and retains manual Telegram review", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const result = await auditIdentityRows(
      [row],
      async () => ({ walletAddress: "0xcanonical", email: "right@example.com" }),
      update,
      true,
    );

    expect(update).toHaveBeenCalledWith("user-1", {
      wallet_address: "0xcanonical",
      email: "right@example.com",
    });
    expect(result.appliedCount).toBe(1);
    expect(result.manualReviewCount).toBe(1);
  });

  it("reports missing Privy users without applying changes", async () => {
    const update = vi.fn();
    const result = await auditIdentityRows(
      [row],
      async () => {
        throw new Error("Privy user not found");
      },
      update,
      true,
    );

    expect(result.findings[0]?.type).toBe("missing_privy_user");
    expect(update).not.toHaveBeenCalled();
  });
});
