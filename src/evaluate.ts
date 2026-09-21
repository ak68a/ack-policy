import type { EvaluateOptions, Policy, PolicyDecision } from "./types.js"

export function evaluate(policy: Policy, options: EvaluateOptions): PolicyDecision {
  const { paymentOption } = options

  let amount: bigint
  try {
    amount = BigInt(paymentOption.amount)
  } catch {
    return {
      status: "denied",
      reason: "Payment amount must be a valid integer in subunits",
    }
  }

  if (amount <= 0n) {
    return {
      status: "denied",
      reason: "Payment amount must be greater than zero",
    }
  }

  const limit = policy.maxAmount.get(paymentOption.currency)
  if (limit === undefined) {
    return {
      status: "denied",
      reason: `No spend limit configured for currency ${paymentOption.currency}`,
    }
  }

  if (amount > limit) {
    return {
      status: "denied",
      reason: "Payment amount exceeds the autonomous spend limit",
    }
  }

  if (policy.recipients) {
    if ("deny" in policy.recipients && policy.recipients.deny) {
      if (policy.recipients.deny.includes(paymentOption.recipient)) {
        return {
          status: "denied",
          reason: "Recipient is on the deny list",
        }
      }
    }

    if ("allow" in policy.recipients && policy.recipients.allow) {
      if (!policy.recipients.allow.includes(paymentOption.recipient)) {
        return {
          status: "approval_required",
          reason: "Recipient is not on the autonomous payment allowlist",
        }
      }
    }
  } else {
    return {
      status: "approval_required",
      reason: "No recipient rules configured",
    }
  }

  return { status: "approved" }
}
