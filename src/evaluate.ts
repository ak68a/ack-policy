import type { EvaluateOptions, Policy, PolicyDecision } from "./types.js"

export async function evaluate(policy: Policy, options: EvaluateOptions): Promise<PolicyDecision> {
  const { paymentOption } = options

  const amount = parseAmount(paymentOption.amount)
  if (amount === null) {
    return denied("Payment amount must be a valid integer in subunits")
  }

  if (amount <= 0n) {
    return denied("Payment amount must be greater than zero")
  }

  const limit = policy.maxAmount.get(paymentOption.currency)
  if (limit === undefined) {
    return denied(`No spend limit configured for currency ${paymentOption.currency}`)
  }

  if (amount > limit) {
    return denied("Payment amount exceeds the autonomous spend limit")
  }

  const recipientDecision = checkRecipient(policy, paymentOption.recipient)
  if (recipientDecision) {
    return recipientDecision
  }

  if (policy.budget) {
    const budgetDecision = await checkBudget(policy.budget, options, amount)
    if (budgetDecision) {
      return budgetDecision
    }
  }

  return { status: "approved" }
}

function parseAmount(raw: number | string): bigint | null {
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

function denied(reason: string): PolicyDecision {
  return { status: "denied", reason }
}

function checkRecipient(policy: Policy, recipient: string): PolicyDecision | null {
  if (!policy.recipients) {
    return { status: "approval_required", reason: "No recipient rules configured" }
  }

  if ("deny" in policy.recipients && policy.recipients.deny) {
    if (policy.recipients.deny.includes(recipient)) {
      return denied("Recipient is on the deny list")
    }
  }

  if ("allow" in policy.recipients && policy.recipients.allow) {
    if (!policy.recipients.allow.includes(recipient)) {
      return { status: "approval_required", reason: "Recipient is not on the autonomous payment allowlist" }
    }
  }

  return null
}

async function checkBudget(
  budget: NonNullable<Policy["budget"]>,
  options: EvaluateOptions,
  amount: bigint,
): Promise<PolicyDecision | null> {
  if (!options.store) {
    return denied("Policy has a budget but no store was provided")
  }
  if (!options.agentDid) {
    return denied("agentDid is required for budget evaluation")
  }
  if (!options.requestId) {
    return denied("requestId is required for budget evaluation")
  }

  const budgetLimit = budget.maxAmount.get(options.paymentOption.currency)
  if (budgetLimit === undefined) {
    return null
  }

  const key = `${options.agentDid}:${options.paymentOption.currency}`
  const idempotencyKey = `${options.requestId}:${options.paymentOption.currency}`

  let result
  try {
    result = await options.store.checkAndReserve({
      key,
      amount,
      limit: budgetLimit,
      windowMs: budget.windowMs,
      idempotencyKey,
    })
  } catch (err) {
    return denied(`Budget check failed: ${err instanceof Error ? err.message : "store error"}`)
  }

  if (!result.allowed) {
    return denied(
      `Budget exceeded: ${result.currentTotal} of ${budgetLimit} ${options.paymentOption.currency} used in current window`,
    )
  }

  return null
}
