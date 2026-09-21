import type { Policy, PolicyConfig } from "./types.js"

export function definePolicy(config: PolicyConfig): Policy {
  const maxAmount = validateAndBuildAmountMap(config.maxAmount, "maxAmount")

  if (config.recipients) {
    if ("allow" in config.recipients && "deny" in config.recipients &&
        config.recipients.allow && config.recipients.deny) {
      throw new Error("recipients must use allow or deny, not both")
    }
  }

  let budget: Policy["budget"] = null
  if (config.budget) {
    if (!config.budget.windowMs || config.budget.windowMs <= 0) {
      throw new Error("budget.windowMs must be a positive number")
    }
    const budgetMaxAmount = validateAndBuildAmountMap(config.budget.maxAmount, "budget.maxAmount")
    budget = { windowMs: config.budget.windowMs, maxAmount: budgetMaxAmount }
  }

  return {
    maxAmount,
    recipients: config.recipients ?? null,
    budget,
  }
}

function validateAndBuildAmountMap(
  raw: Record<string, bigint>,
  label: string,
): Map<string, bigint> {
  if (!raw || Object.keys(raw).length === 0) {
    throw new Error(`${label} must have at least one currency configured`)
  }

  const map = new Map<string, bigint>()

  for (const [currency, limit] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(raw, currency)) {
      continue
    }
    if (typeof limit !== "bigint") {
      throw new Error(`${label}.${currency} must be a bigint`)
    }
    if (limit <= 0n) {
      throw new Error(`${label}.${currency} must be positive`)
    }
    map.set(currency, limit)
  }

  return map
}
