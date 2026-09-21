import type { Policy, PolicyConfig } from "./types.js"

export function definePolicy(config: PolicyConfig): Policy {
  if (!config.maxAmount || Object.keys(config.maxAmount).length === 0) {
    throw new Error("maxAmount must have at least one currency configured")
  }

  for (const [currency, limit] of Object.entries(config.maxAmount)) {
    if (typeof limit !== "bigint") {
      throw new Error(`maxAmount.${currency} must be a bigint`)
    }
    if (limit <= 0n) {
      throw new Error(`maxAmount.${currency} must be positive`)
    }
  }

  if (config.recipients) {
    if ("allow" in config.recipients && "deny" in config.recipients &&
        config.recipients.allow && config.recipients.deny) {
      throw new Error("recipients must use allow or deny, not both")
    }
  }

  const maxAmount = new Map<string, bigint>()
  for (const [currency, limit] of Object.entries(config.maxAmount)) {
    if (Object.prototype.hasOwnProperty.call(config.maxAmount, currency)) {
      maxAmount.set(currency, limit)
    }
  }

  return {
    maxAmount,
    recipients: config.recipients ?? null,
  }
}
