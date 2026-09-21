# Getting Started

This guide walks through integrating ack-policy into an agent that makes ACK payments. By the end you'll have a working policy that enforces per-transaction spend limits and recipient rules.

## Install

```bash
npm install ack-policy agentcommercekit
```

`agentcommercekit` is a peer dependency — ack-policy uses its `PaymentOption` type but doesn't bundle it.

## Define a policy

A policy is a set of constraints that every payment must satisfy before the agent executes it. You define it once, typically at agent startup.

```typescript
import { definePolicy } from "ack-policy"

const policy = definePolicy({
  // Per-transaction spend limits, keyed by currency code.
  // Values are in the currency's smallest subunit (bigint).
  // A currency not listed here is denied outright.
  maxAmount: {
    USDC: 5_000_000n,   // 5.00 USDC (6 decimal places)
    USD: 500n,           // 5.00 USD (2 decimal places)
  },

  // Recipient rules. Use `allow` OR `deny`, not both.
  recipients: {
    allow: [
      "did:web:staples.com",
      "did:web:amazon.com",
    ],
  },
})
```

### Why bigint?

Payment amounts in ACK are expressed in a currency's smallest subunit — cents for USD, micro-units for USDC. Using `bigint` avoids floating-point errors that would be catastrophic in financial math. `5_000_000n` is 5.00 USDC, not five million dollars.

### Why per-currency limits?

USD has 2 decimal places. USDC has 6. ETH has 18. A single numeric threshold across all currencies is meaningless — `500` means $5.00 in USD and $0.000500 in USDC. Per-currency limits expressed in subunits eliminate this ambiguity.

## Evaluate a payment

When your agent receives a payment request from a merchant, it contains one or more `PaymentOption` objects — each one a way to pay (different currency, different network, different amount). Run each option through the policy before executing.

```typescript
import { evaluate } from "ack-policy"
import type { PaymentOption } from "agentcommercekit"

// This comes from an ACK payment request
const paymentOption: PaymentOption = {
  id: "option-1",
  amount: 3_500_000,     // 3.50 USDC
  decimals: 6,
  currency: "USDC",
  recipient: "did:web:staples.com",
}

const decision = evaluate(policy, { paymentOption })
```

`evaluate` is synchronous for per-transaction checks. It returns a `PolicyDecision`:

```typescript
type PolicyDecision =
  | { status: "approved" }
  | { status: "approval_required"; reason: string }
  | { status: "denied"; reason: string }
```

## Handle decisions

Every evaluation produces one of three outcomes.

### Approved

The payment is within all configured constraints. The agent can execute it autonomously.

```typescript
if (decision.status === "approved") {
  await executePayment(paymentOption)
}
```

### Approval required

The payment doesn't violate a hard constraint, but it falls outside the pre-authorized scope. The most common trigger: the recipient isn't on the allowlist. The agent should ask the human.

```typescript
if (decision.status === "approval_required") {
  // "Agent wants to pay 3.50 USDC to did:web:staples.com.
  //  Reason: Recipient is not on the autonomous payment allowlist."
  const approved = await askUser(paymentOption, decision.reason)
  if (approved) {
    await executePayment(paymentOption)
  }
}
```

This is the key difference from a binary allow/deny system. An unknown recipient isn't necessarily malicious — the user might have forgotten to add it. `approval_required` lets a human break the tie without the agent guessing.

### Denied

The payment violates a hard constraint — amount exceeds the cap, currency isn't configured, or the amount is malformed. The agent must not execute.

```typescript
if (decision.status === "denied") {
  log.warn(`Payment denied: ${decision.reason}`)
  // Do not execute. Do not ask the user to override.
}
```

## Putting it together

A realistic agent integration that evaluates multiple payment options and picks the first approved one:

```typescript
import { definePolicy, evaluate } from "ack-policy"

const policy = definePolicy({
  maxAmount: {
    USDC: 10_000_000n,  // 10.00 USDC per transaction
    USD: 1_000n,         // 10.00 USD per transaction
  },
  recipients: {
    allow: ["did:web:staples.com", "did:web:amazon.com"],
  },
})

async function handlePaymentRequest(request: PaymentRequest) {
  for (const option of request.paymentOptions) {
    const decision = await evaluate(policy, { paymentOption: option })

    switch (decision.status) {
      case "approved":
        await executePayment(option)
        return

      case "approval_required":
        const ok = await askUser(option, decision.reason)
        if (ok) {
          await executePayment(option)
          return
        }
        continue

      case "denied":
        log.info(`Option ${option.id} denied: ${decision.reason}`)
        continue
    }
  }

  log.error("No payment option passed policy evaluation")
}
```

## Rolling window budgets

Per-transaction limits are necessary but not sufficient. An agent with a $5 per-transaction cap can make twenty $5 payments and spend $100. Rolling window budgets track cumulative spend over a time window and deny payments that would exceed the total.

```typescript
import { definePolicy, evaluate, createMemoryStore } from "ack-policy"

const policy = definePolicy({
  maxAmount: {
    USDC: 10_000_000n,   // 10.00 USDC per transaction
  },
  recipients: {
    allow: ["did:web:staples.com"],
  },
  budget: {
    windowMs: 24 * 60 * 60 * 1000,   // 24-hour rolling window
    maxAmount: {
      USDC: 50_000_000n,              // 50.00 USDC per day cumulative
    },
  },
})

const store = createMemoryStore()
```

When a policy has a budget, `evaluate` requires two additional fields — `agentDid` (to isolate spend per agent) and `store` (to track cumulative totals):

```typescript
const decision = await evaluate(policy, {
  paymentOption: option,
  agentDid: "did:web:my-agent.com",
  store,
  requestId: paymentRequest.id,  // for idempotent re-evaluation
})
```

### Handling payment success and failure

The budget reserves the amount when evaluation returns `approved`. If the payment then fails, release the reservation so it doesn't permanently consume budget:

```typescript
const decision = await evaluate(policy, {
  paymentOption: option,
  agentDid: "did:web:my-agent.com",
  store,
  requestId: "req-123",
})

if (decision.status === "approved") {
  try {
    await executePayment(option)
    await store.commit("req-123:USDC")  // payment succeeded, lock it in
  } catch {
    await store.release("req-123:USDC") // payment failed, free the budget
  }
}
```

The idempotency key for the store is `${requestId}:${currency}`. If you call `evaluate` again with the same `requestId`, the store returns the previous result without double-counting.

### What `createMemoryStore` is for

`createMemoryStore()` is an in-memory implementation of the `PolicyStore` interface. It works for single-instance agents and testing. It does not persist across process restarts.

For production deployments that need persistence or multi-instance coordination, implement the `PolicyStore` interface against your database. The interface has three methods: `checkAndReserve`, `commit`, and `release`.

## What's next

- **[API Reference](./api.md)** — full type definitions and function signatures
- **[Architecture](./architecture.md)** — how ack-policy fits into the ACK ecosystem
- Grant integration is coming once ACK v2 ships — see the roadmap
