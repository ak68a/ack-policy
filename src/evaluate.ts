import type { EvaluateOptions, Policy, PolicyDecision } from "./types.js"

export async function evaluate(policy: Policy, options: EvaluateOptions): Promise<PolicyDecision> {
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

  if (policy.budget) {
    if (!options.store) {
      return {
        status: "denied",
        reason: "Policy has a budget but no store was provided",
      }
    }
    if (!options.agentDid) {
      return {
        status: "denied",
        reason: "agentDid is required for budget evaluation",
      }
    }

    const budgetLimit = policy.budget.maxAmount.get(paymentOption.currency)
    if (budgetLimit === undefined) {
      return { status: "approved" }
    }

    const key = `${options.agentDid}:${paymentOption.currency}`
    const idempotencyKey = options.requestId
      ? `${options.requestId}:${paymentOption.currency}`
      : `${Date.now()}:${Math.random()}`

    const result = await options.store.checkAndReserve({
      key,
      amount,
      limit: budgetLimit,
      windowMs: policy.budget.windowMs,
      idempotencyKey,
    })

    if (!result.allowed) {
      return {
        status: "denied",
        reason: `Budget exceeded: ${result.currentTotal} of ${budgetLimit} ${paymentOption.currency} used in current window`,
      }
    }
  }

  return { status: "approved" }
}
