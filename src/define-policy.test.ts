import { describe, expect, it } from "vitest"
import { definePolicy } from "./define-policy.js"

describe("definePolicy", () => {
  it("creates a policy from valid config", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { allow: ["did:web:merchant.com"] },
    })

    expect(policy.maxAmount.get("USDC")).toBe(5_000_000n)
    expect(policy.recipients).toEqual({ allow: ["did:web:merchant.com"] })
  })

  it("creates a policy with multiple currencies", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n, USD: 500n, ETH: 10_000_000_000_000_000n },
    })

    expect(policy.maxAmount.size).toBe(3)
    expect(policy.maxAmount.get("ETH")).toBe(10_000_000_000_000_000n)
  })

  it("creates a policy with deny list", () => {
    const policy = definePolicy({
      maxAmount: { USDC: 5_000_000n },
      recipients: { deny: ["did:web:blocked.com"] },
    })

    expect(policy.recipients).toEqual({ deny: ["did:web:blocked.com"] })
  })

  it("creates a policy with no recipient rules", () => {
    const policy = definePolicy({ maxAmount: { USDC: 5_000_000n } })
    expect(policy.recipients).toBeNull()
  })

  it("throws on empty maxAmount", () => {
    expect(() => definePolicy({ maxAmount: {} })).toThrow(
      "maxAmount must have at least one currency configured",
    )
  })

  it("throws on non-positive limit", () => {
    expect(() => definePolicy({ maxAmount: { USDC: 0n } })).toThrow(
      "maxAmount.USDC must be positive",
    )
    expect(() => definePolicy({ maxAmount: { USDC: -1n } })).toThrow(
      "maxAmount.USDC must be positive",
    )
  })

  it("ignores inherited prototype keys on maxAmount", () => {
    const config = Object.create({ constructor: 999n })
    config.USDC = 5_000_000n
    const policy = definePolicy({ maxAmount: config })
    expect(policy.maxAmount.has("constructor")).toBe(false)
    expect(policy.maxAmount.get("USDC")).toBe(5_000_000n)
  })
})
