# ack-policy

Policy engine for [Agent Commerce Kit](https://github.com/agentcommercekit/ack) — enforce spend limits, recipient rules, and rolling budgets on agent payments before they execute.

```
Payment Request → parse options → evaluate policy → sign/execute → receipt
                                   ↑ ack-policy
```

## Why

When an AI agent makes payments on behalf of a user, something needs to answer: *is this payment within the scope the user authorized?*

ACK's demo includes a [minimal policy check](https://github.com/agentcommercekit/ack/blob/main/demos/payments/src/payment-policy.ts) — per-transaction caps and a recipient allowlist. It's enough for a demo. It's not enough for production, because a per-transaction cap is trivially defeated by splitting one $500 payment into five $100 payments.

ack-policy is the standalone, production-quality version. It handles the things the demo deliberately left out: cumulative budgets over rolling time windows, atomic check-and-reserve to prevent split attacks, currency-aware amount tracking in smallest subunits, and pluggable storage for persistent state.

## Install

```bash
npm install ack-policy
```

Peer dependency: [`agentcommercekit`](https://github.com/agentcommercekit/ack) for the `PaymentOption` type.

## Quick example

```typescript
import { definePolicy, evaluate } from "ack-policy"

const policy = definePolicy({
  // Per-transaction limits in smallest subunits
  maxAmount: {
    USDC: 5_000_000n,  // 5.00 USDC (6 decimals)
    USD: 500n,          // 5.00 USD (2 decimals)
  },
  // Only these recipients can be paid autonomously
  recipients: {
    allow: ["did:web:staples.com", "did:web:amazon.com"],
  },
})

// paymentOption comes from an ACK PaymentRequest
const decision = await evaluate(policy, { paymentOption })

if (decision.status === "approved") {
  // safe to execute the payment
}

if (decision.status === "approval_required") {
  // ask the human — the payment is plausible but not pre-authorized
  console.log(decision.reason)
}

if (decision.status === "denied") {
  // hard stop — the payment violates a constraint
  console.log(decision.reason)
}
```

## Features

### Available now (v0.2)

- **Per-transaction amount limits** — per-currency caps in smallest subunits (bigint). A currency with no configured limit is denied.
- **Recipient rules** — allowlist or denylist. Unknown recipients return `approval_required`, not `denied`, so a human can override.
- **Currency allowlist** — unconfigured currencies are denied outright.
- **Three-valued decisions** — `approved`, `approval_required`, or `denied`. Each non-approved decision includes a reason string.
- **Rolling window budgets** — cumulative spend tracking over configurable time windows with atomic check-and-reserve to prevent split attacks. Per-agent, per-currency isolation.
- **Pluggable storage** — `PolicyStore` interface with an in-memory implementation. Implement the interface for Redis, Postgres, or any persistent backend.
- **Idempotent evaluation** — same `requestId` won't double-count against the budget.
- **Reservation lifecycle** — commit on payment success, release on failure. Failed payments don't permanently consume budget.

### Planned

- **Grant integration** — cross-check payments against ACK v2 grant claims (scope, audience, constraints, expiry). Waiting on v2 landing in ACK core.

See the roadmap in `.plans/` for the full plan.

## Documentation

- **[Getting Started](./docs/getting-started.md)** — install, define a policy, evaluate payments, handle decisions
- **[API Reference](./docs/api.md)** — every exported function, type, and interface
- **[Architecture](./docs/architecture.md)** — how ack-policy fits into the ACK ecosystem and why certain decisions were made

## Relationship to ACK

This is a companion package, not a fork. It imports ACK's published types (`PaymentOption`) but is maintained separately. The ACK maintainer considers runtime policy enforcement [out of scope for the core protocol](https://github.com/agentcommercekit/ack/issues/138).

ack-policy complements the [dispute resolution proposal](https://github.com/agentcommercekit/ack/issues/217): grants define what an agent *may* do, the policy engine prevents what it *shouldn't* do at runtime, and dispute evidence proves what it *did* do after the fact.

## License

MIT
