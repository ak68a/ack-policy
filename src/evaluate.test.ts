import { describe, expect, it } from "vitest"
import { definePolicy } from "./define-policy.js"
import { evaluate } from "./evaluate.js"

const baseOption = {
  id: "opt-1",
  amount: 1_000_000,
  decimals: 6,
  currency: "USDC",
  recipient: "did:web:merchant.com",
}

describe("evaluate", () => {
  describe("amount checks", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n, USD: 500n },
      recipients: { allow: [baseOption.recipient] },
    })

    it("approves payments below the limit", () => {
      const decision = evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })

    it("approves payments at exactly the limit", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_000 },
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("denies payments above the limit", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_001 },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount exceeds the autonomous spend limit",
      })
    })

    it("handles string amounts", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: "3000000" },
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("denies fractional amounts", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: "1.5" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount must be a valid integer in subunits",
      })
    })

    it("denies zero amounts", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: 0 },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount must be greater than zero",
      })
    })

    it("denies negative amounts", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: -100 },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount must be greater than zero",
      })
    })

    it("applies per-currency limits independently", () => {
      const usdDecision = evaluate(policy, {
        paymentOption: { ...baseOption, amount: 400, decimals: 2, currency: "USD" },
      })
      expect(usdDecision).toEqual({ status: "approved" })

      const usdOverLimit = evaluate(policy, {
        paymentOption: { ...baseOption, amount: 501, decimals: 2, currency: "USD" },
      })
      expect(usdOverLimit.status).toBe("denied")
    })
  })

  describe("currency checks", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { allow: [baseOption.recipient] },
    })

    it("denies unconfigured currencies", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, currency: "SOL" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "No spend limit configured for currency SOL",
      })
    })

    it("is safe against prototype key currencies", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, currency: "constructor" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "No spend limit configured for currency constructor",
      })
    })
  })

  describe("recipient allowlist", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { allow: ["did:web:merchant.com", "did:web:vendor.com"] },
    })

    it("approves allowed recipients", () => {
      const decision = evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })

    it("returns approval_required for unknown recipients", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, recipient: "did:web:unknown.com" },
      })
      expect(decision).toEqual({
        status: "approval_required",
        reason: "Recipient is not on the autonomous payment allowlist",
      })
    })
  })

  describe("recipient denylist", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { deny: ["did:web:blocked.com"] },
    })

    it("denies blocked recipients", () => {
      const decision = evaluate(policy, {
        paymentOption: { ...baseOption, recipient: "did:web:blocked.com" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Recipient is on the deny list",
      })
    })

    it("approves non-blocked recipients", () => {
      const decision = evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })
  })

  describe("no recipient rules", () => {
    const policy = definePolicy({ maxAmount: { USDC: 5_000_000n } })

    it("returns approval_required when no recipient rules configured", () => {
      const decision = evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({
        status: "approval_required",
        reason: "No recipient rules configured",
      })
    })
  })

  describe("evaluation order", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { allow: ["did:web:merchant.com"] },
    })

    it("denies on amount before checking recipient", () => {
      const decision = evaluate(policy, {
        paymentOption: {
          ...baseOption,
          amount: 99_000_000,
          recipient: "did:web:unknown.com",
        },
      })
      expect(decision.status).toBe("denied")
      expect("reason" in decision && decision.reason).toContain("spend limit")
    })

    it("denies on currency before checking recipient", () => {
      const decision = evaluate(policy, {
        paymentOption: {
          ...baseOption,
          currency: "ETH",
          recipient: "did:web:unknown.com",
        },
      })
      expect(decision.status).toBe("denied")
      expect("reason" in decision && decision.reason).toContain("No spend limit")
    })
  })
})
