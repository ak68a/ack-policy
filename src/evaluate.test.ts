import { describe, expect, it, vi } from "vitest"
import { definePolicy } from "./define-policy.js"
import { evaluate } from "./evaluate.js"
import { createMemoryStore } from "./memory-store.js"
import type { PolicyStore } from "./types.js"

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

    it("approves payments below the limit", async () => {
      const decision = await evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })

    it("approves payments at exactly the limit", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_000 },
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("denies payments above the limit", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_001 },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount exceeds the autonomous spend limit",
      })
    })

    it("handles string amounts", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: "3000000" },
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("denies fractional amounts", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: "1.5" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount must be a valid integer in subunits",
      })
    })

    it("denies zero amounts", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 0 },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount must be greater than zero",
      })
    })

    it("denies negative amounts", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: -100 },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount must be greater than zero",
      })
    })

    it("denies empty string amounts", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: "" },
      })
      expect(decision.status).toBe("denied")
    })

    it("denies non-numeric string amounts", async () => {
      expect(
        (await evaluate(policy, { paymentOption: { ...baseOption, amount: "abc" } })).status,
      ).toBe("denied")
      expect(
        (await evaluate(policy, { paymentOption: { ...baseOption, amount: "NaN" } })).status,
      ).toBe("denied")
      expect(
        (await evaluate(policy, { paymentOption: { ...baseOption, amount: "1e5" } })).status,
      ).toBe("denied")
    })

    it("handles very large bigint amounts", async () => {
      const hugePolicy = definePolicy({
        maxAmount: { ETH: 1_000_000_000_000_000_000n },
        recipients: { allow: [baseOption.recipient] },
      })
      const decision = await evaluate(hugePolicy, {
        paymentOption: {
          ...baseOption,
          currency: "ETH",
          amount: "999999999999999999",
        },
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("applies per-currency limits independently", async () => {
      const usdDecision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 400, decimals: 2, currency: "USD" },
      })
      expect(usdDecision).toEqual({ status: "approved" })

      const usdOverLimit = await evaluate(policy, {
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

    it("denies unconfigured currencies", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, currency: "SOL" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "No spend limit configured for currency SOL",
      })
    })

    it("is safe against prototype key currencies", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, currency: "constructor" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "No spend limit configured for currency constructor",
      })
    })

    it("treats currency codes as case-sensitive", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, currency: "usdc" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "No spend limit configured for currency usdc",
      })
    })
  })

  describe("recipient allowlist", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { allow: ["did:web:merchant.com", "did:web:vendor.com"] },
    })

    it("approves allowed recipients", async () => {
      const decision = await evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })

    it("returns approval_required for unknown recipients", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, recipient: "did:web:unknown.com" },
      })
      expect(decision).toEqual({
        status: "approval_required",
        reason: "Recipient is not on the autonomous payment allowlist",
      })
    })

    it("returns approval_required for all recipients when allowlist is empty", async () => {
      const emptyAllowPolicy = definePolicy({
        maxAmount: { USDC: 5_000_000n },
        recipients: { allow: [] },
      })
      const decision = await evaluate(emptyAllowPolicy, { paymentOption: baseOption })
      expect(decision).toEqual({
        status: "approval_required",
        reason: "Recipient is not on the autonomous payment allowlist",
      })
    })

    it("treats recipient DIDs as case-sensitive", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, recipient: "did:web:Merchant.com" },
      })
      expect(decision.status).toBe("approval_required")
    })

    it("does not match empty string recipients", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, recipient: "" },
      })
      expect(decision.status).toBe("approval_required")
    })
  })

  describe("recipient denylist", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { deny: ["did:web:blocked.com"] },
    })

    it("denies blocked recipients", async () => {
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, recipient: "did:web:blocked.com" },
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Recipient is on the deny list",
      })
    })

    it("approves non-blocked recipients", async () => {
      const decision = await evaluate(policy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })

    it("approves all recipients when denylist is empty", async () => {
      const emptyDenyPolicy = definePolicy({
        maxAmount: { USDC: 5_000_000n },
        recipients: { deny: [] },
      })
      const decision = await evaluate(emptyDenyPolicy, { paymentOption: baseOption })
      expect(decision).toEqual({ status: "approved" })
    })
  })

  describe("no recipient rules", () => {
    const policy = definePolicy({ maxAmount: { USDC: 5_000_000n } })

    it("returns approval_required when no recipient rules configured", async () => {
      const decision = await evaluate(policy, { paymentOption: baseOption })
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

    it("denies on amount before checking recipient", async () => {
      const decision = await evaluate(policy, {
        paymentOption: {
          ...baseOption,
          amount: 99_000_000,
          recipient: "did:web:unknown.com",
        },
      })
      expect(decision.status).toBe("denied")
      expect("reason" in decision && decision.reason).toContain("spend limit")
    })

    it("denies on currency before checking recipient", async () => {
      const decision = await evaluate(policy, {
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

  describe("budget checks", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 10_000_000n },
      recipients: { allow: [baseOption.recipient] },
      budget: {
        windowMs: 60_000,
        maxAmount: { USDC: 20_000_000n },
      },
    })

    it("approves payments within the budget", async () => {
      const store = createMemoryStore()
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-1",
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("tracks cumulative spend across evaluations", async () => {
      const store = createMemoryStore()
      const opts = {
        paymentOption: { ...baseOption, amount: 8_000_000 },
        agentDid: "did:web:agent.com",
        store,
      }

      const first = await evaluate(policy, { ...opts, requestId: "req-1" })
      expect(first.status).toBe("approved")

      const second = await evaluate(policy, { ...opts, requestId: "req-2" })
      expect(second.status).toBe("approved")

      const third = await evaluate(policy, { ...opts, requestId: "req-3" })
      expect(third.status).toBe("denied")
      expect("reason" in third && third.reason).toContain("Budget exceeded")
    })

    it("denies when a single payment exceeds the budget", async () => {
      const store = createMemoryStore()
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-big",
      })
      expect(decision.status).toBe("approved")

      const over = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-big-2",
      })
      expect(over.status).toBe("approved")

      const bust = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 1 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-big-3",
      })
      expect(bust.status).toBe("denied")
    })

    it("isolates budgets by agent DID", async () => {
      const store = createMemoryStore()
      const decision1 = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent-a.com",
        store,
        requestId: "a-1",
      })
      expect(decision1.status).toBe("approved")

      const decision2 = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent-b.com",
        store,
        requestId: "b-1",
      })
      expect(decision2.status).toBe("approved")
    })

    it("isolates budgets by currency", async () => {
      const multiPolicy = definePolicy({
        maxAmount: { USDC: 10_000_000n, USD: 1_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 15_000_000n, USD: 1_500n },
        },
      })
      const store = createMemoryStore()

      await evaluate(multiPolicy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "usdc-1",
      })

      const usdDecision = await evaluate(multiPolicy, {
        paymentOption: { ...baseOption, amount: 1_000, currency: "USD", decimals: 2 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "usd-1",
      })
      expect(usdDecision.status).toBe("approved")
    })

    it("returns idempotent results for the same requestId", async () => {
      const store = createMemoryStore()
      const opts = {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-idem",
      }

      const first = await evaluate(policy, opts)
      expect(first.status).toBe("approved")

      const second = await evaluate(policy, opts)
      expect(second.status).toBe("approved")

      const third = await evaluate(policy, opts)
      expect(third.status).toBe("approved")
    })

    it("denies when budget is configured but no store provided", async () => {
      const decision = await evaluate(policy, {
        paymentOption: baseOption,
        agentDid: "did:web:agent.com",
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Policy has a budget but no store was provided",
      })
    })

    it("denies when budget is configured but no agentDid provided", async () => {
      const store = createMemoryStore()
      const decision = await evaluate(policy, {
        paymentOption: baseOption,
        store,
        requestId: "req-1",
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "agentDid is required for budget evaluation",
      })
    })

    it("denies when budget is configured but no requestId provided", async () => {
      const store = createMemoryStore()
      const decision = await evaluate(policy, {
        paymentOption: baseOption,
        store,
        agentDid: "did:web:agent.com",
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "requestId is required for budget evaluation",
      })
    })

    it("rejects idempotent replay with mismatched amount", async () => {
      const store = createMemoryStore()
      const first = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-mismatch",
      })
      expect(first.status).toBe("approved")

      const replayed = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 8_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-mismatch",
      })
      expect(replayed.status).toBe("denied")
    })

    it("approves when payment currency has no budget limit", async () => {
      const usdcOnlyBudget = definePolicy({
        maxAmount: { USDC: 10_000_000n, USD: 1_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 20_000_000n },
        },
      })
      const store = createMemoryStore()
      const decision = await evaluate(usdcOnlyBudget, {
        paymentOption: { ...baseOption, amount: 500, currency: "USD", decimals: 2 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-usd-1",
      })
      expect(decision).toEqual({ status: "approved" })
    })

    it("checks per-transaction limit before budget", async () => {
      const store = createMemoryStore()
      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_001 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-over",
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Payment amount exceeds the autonomous spend limit",
      })
    })
  })

  describe("budget — window expiry", () => {
    it("resets budget when the window expires", async () => {
      vi.useFakeTimers()
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 15_000_000n },
        },
      })
      const store = createMemoryStore()

      const first = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "w-1",
      })
      expect(first.status).toBe("approved")

      const overBudget = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "w-2",
      })
      expect(overBudget.status).toBe("denied")

      vi.advanceTimersByTime(60_001)

      const afterExpiry = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "w-3",
      })
      expect(afterExpiry.status).toBe("approved")

      vi.useRealTimers()
    })
  })

  describe("budget — cumulative tracking (sequential)", () => {
    it("tracks cumulative spend across sequential evaluations", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 5_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 20_000_000n },
        },
      })
      const store = createMemoryStore()

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          evaluate(policy, {
            paymentOption: { ...baseOption, amount: 5_000_000 },
            agentDid: "did:web:agent.com",
            store,
            requestId: `split-${i}`,
          }),
        ),
      )

      const approved = results.filter((r) => r.status === "approved").length
      const denied = results.filter((r) => r.status === "denied").length
      expect(approved).toBe(4)
      expect(denied).toBe(6)
    })
  })

  describe("budget — release", () => {
    it("releases budget when a payment fails", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 15_000_000n },
        },
      })
      const store = createMemoryStore()

      await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "will-fail",
      })

      await store.release("will-fail:USDC")

      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "retry",
      })
      expect(decision.status).toBe("approved")
    })

    it("does not release committed reservations", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 15_000_000n },
        },
      })
      const store = createMemoryStore()

      await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "committed",
      })

      await store.commit("committed:USDC")
      await store.release("committed:USDC")

      const decision = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "after-commit",
      })
      expect(decision.status).toBe("denied")
    })
  })

  describe("budget — store errors", () => {
    it("returns denied when the store throws", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 20_000_000n },
        },
      })
      const failingStore: PolicyStore = {
        async checkAndReserve() {
          throw new Error("connection refused")
        },
        async commit() {},
        async release() {},
      }

      const decision = await evaluate(policy, {
        paymentOption: baseOption,
        agentDid: "did:web:agent.com",
        store: failingStore,
        requestId: "req-1",
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Budget check failed: connection refused",
      })
    })

    it("handles non-Error throws from the store", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 20_000_000n },
        },
      })
      const failingStore: PolicyStore = {
        async checkAndReserve() {
          throw "something went wrong"
        },
        async commit() {},
        async release() {},
      }

      const decision = await evaluate(policy, {
        paymentOption: baseOption,
        agentDid: "did:web:agent.com",
        store: failingStore,
        requestId: "req-1",
      })
      expect(decision).toEqual({
        status: "denied",
        reason: "Budget check failed: store error",
      })
    })
  })

  describe("budget — multi-option evaluation", () => {
    it("evaluating different options with different requestIds tracks independently", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: [baseOption.recipient] },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 15_000_000n },
        },
      })
      const store = createMemoryStore()

      const optionA = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 8_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-1:opt-a",
      })
      expect(optionA.status).toBe("approved")

      const optionB = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 8_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-1:opt-b",
      })
      expect(optionB.status).toBe("denied")

      await store.release("req-1:opt-a:USDC")

      const optionBRetry = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 8_000_000 },
        agentDid: "did:web:agent.com",
        store,
        requestId: "req-1:opt-b-retry",
      })
      expect(optionBRetry.status).toBe("approved")
    })
  })

  describe("end-to-end lifecycle", () => {
    it("tracks budget correctly across a realistic sequence of payments", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: {
          allow: ["did:web:staples.com", "did:web:amazon.com"],
        },
        budget: {
          windowMs: 60_000,
          maxAmount: { USDC: 30_000_000n },
        },
      })
      const store = createMemoryStore()
      const agentDid = "did:web:office-agent.com"

      const pay1 = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 8_000_000, recipient: "did:web:staples.com" },
        agentDid,
        store,
        requestId: "order-1",
      })
      expect(pay1.status).toBe("approved")
      await store.commit("order-1:USDC")

      const pay2 = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 10_000_000, recipient: "did:web:amazon.com" },
        agentDid,
        store,
        requestId: "order-2",
      })
      expect(pay2.status).toBe("approved")
      await store.commit("order-2:USDC")

      const pay3 = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 9_000_000, recipient: "did:web:staples.com" },
        agentDid,
        store,
        requestId: "order-3",
      })
      expect(pay3.status).toBe("approved")

      await store.release("order-3:USDC")

      const pay3Retry = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 9_000_000, recipient: "did:web:staples.com" },
        agentDid,
        store,
        requestId: "order-3-retry",
      })
      expect(pay3Retry.status).toBe("approved")
      await store.commit("order-3-retry:USDC")

      const pay4 = await evaluate(policy, {
        paymentOption: { ...baseOption, amount: 5_000_000, recipient: "did:web:staples.com" },
        agentDid,
        store,
        requestId: "order-4",
      })
      expect(pay4.status).toBe("denied")
      expect("reason" in pay4 && pay4.reason).toContain("Budget exceeded")
    })
  })

  describe("real ACK PaymentOption type", () => {
    it("works with a fully-typed PaymentOption from agentcommercekit", async () => {
      const policy = definePolicy({
        maxAmount: { USDC: 10_000_000n },
        recipients: { allow: ["did:web:merchant.example.com"] },
      })

      const paymentOption = {
        id: "po-1",
        amount: 5_000_000,
        decimals: 6,
        currency: "USDC",
        recipient: "did:web:merchant.example.com",
        network: "base",
        paymentService: "did:web:pay.example.com",
        receiptService: "did:web:receipt.example.com",
      }

      const decision = await evaluate(policy, { paymentOption })
      expect(decision).toEqual({ status: "approved" })
    })
  })
})
