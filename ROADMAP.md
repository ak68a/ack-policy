# ack-policy — Roadmap

## Problem statement

The ACK payments demo includes a minimal policy engine (`demos/payments/src/payment-policy.ts`) that enforces per-transaction spend limits and a recipient allowlist. The code itself documents why this isn't enough:

> This is a per-transaction cap only, not a cumulative or rate budget. A real spend control needs windowed/cumulative limits, since a per-transaction cap is trivially split-gameable.

Issue [#138](https://github.com/agentcommercekit/ack/issues/138) and PR [#187](https://github.com/agentcommercekit/ack/pull/187) close part of the gap by adding a rolling-window budget inside the demo, but the implementation is deliberately scoped to `demos/payments` — in-memory, single-instance, demo-grade.

What's missing is a **standalone, production-quality policy engine** that:

- Can be used by any ACK consumer, not just the demo
- Supports persistent state (not just in-memory)
- Handles concurrent evaluations atomically
- Integrates with v2 grants as the authorization scope artifact
- Produces policy decisions that can be referenced in dispute evidence

### What the demo does today

```typescript
interface PaymentPolicy {
  allowedRecipients: readonly string[]
  maxAutonomousAmount: Readonly<Record<string, bigint>>
}

// Returns: "approved" | "approval_required" | "denied"
evaluatePaymentPolicy(paymentOption, policy)
```

Checks: (1) amount is a valid positive integer in subunits, (2) currency has a configured limit, (3) amount ≤ limit, (4) recipient is in the allowlist. No time windows, no cumulative tracking, no category rules, no grant integration.

PR #187 adds an optional `budget: { windowMs, maxWindowAmount }` with an in-memory `Map` — the right shape, but coupled to the demo and not publishable.

## Core features

### 1. Per-transaction constraints (parity with demo)

- Per-currency spend limits in smallest subunit (bigint)
- Recipient allowlist / denylist
- Currency allowlist (deny unconfigured currencies)

### 2. Rolling window budgets

- Cumulative spend tracking over a configurable time window
- Per-currency windows (e.g. max 100 USDC per 24h)
- Per-agent windows (isolate spend by agent DID)
- Atomic check-and-reserve to prevent split-attack races
- Idempotent re-evaluation keyed by payment request ID + option ID

### 3. Category and scope rules

- Category allowlist/denylist (when grant `constraints.category` is present)
- Scope matching against grant `scope` claim
- Audience restrictions (which relying parties the agent may pay)

### 4. Time-of-day and temporal rules

- Business-hours-only payments
- Cooldown periods between transactions
- Maximum transaction frequency (rate limiting)

### 5. Pluggable storage

- In-memory adapter for testing and demos
- Interface for persistent storage (Redis, SQLite, Postgres)
- Storage contract: atomic read-check-write for window budgets

## API design sketch

### Policy definition

```typescript
import { definePolicy, perCurrency } from "ack-policy"

const policy = definePolicy({
  // Per-transaction constraints
  maxAmount: perCurrency({
    USDC: 5_000_000n,  // 5.00 USDC (6 decimals)
    USD: 500n,          // 5.00 USD (2 decimals)
  }),

  // Recipient rules
  recipients: {
    allow: ["did:web:merchant.com", "did:web:vendor.example.com"],
    // OR: deny: ["did:web:sanctioned.example.com"]
  },

  // Rolling window budget
  budget: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxWindowAmount: perCurrency({
      USDC: 100_000_000n, // 100 USDC per day
    }),
  },

  // Temporal rules (optional)
  schedule: {
    allowedHours: { start: 9, end: 17 }, // business hours UTC
    timezone: "UTC",
  },
})
```

### Policy evaluation

```typescript
import type { PaymentOption } from "agentcommercekit"

interface PolicyDecision {
  status: "approved" | "approval_required" | "denied"
  reason?: string
  // Reference for dispute evidence — identifies which policy
  // was applied and what the evaluated state was
  policyRef?: string
}

interface EvaluateOptions {
  paymentOption: PaymentOption
  agentDid: string
  // For idempotent re-evaluation
  paymentRequestId: string
  paymentOptionId: string
  // v2 grant for scope/constraint checking
  grant?: GrantPayload
  // Storage adapter for window budgets
  store?: PolicyStore
}

const decision: PolicyDecision = await evaluate(policy, options)
```

### Storage interface

```typescript
interface PolicyStore {
  // Atomic: read current window total, add amount if under limit,
  // return the decision. Must be atomic to prevent split attacks.
  checkAndReserve(params: {
    key: string          // e.g. "agent:did:web:acme.com:shopper:USDC"
    amount: bigint
    limit: bigint
    windowMs: number
    idempotencyKey: string
  }): Promise<{ allowed: boolean; currentTotal: bigint; windowResetAt: Date }>

  // Commit a reservation (payment succeeded)
  commit(idempotencyKey: string): Promise<void>

  // Release a reservation (payment failed)
  release(idempotencyKey: string): Promise<void>
}
```

## Integration points

### With ACK payment requests

The policy evaluates a `PaymentOption` from a payment request before the agent signs or executes. This is the same integration point the demo uses — policy runs between receiving the payment request and calling the payment service.

```
Payment Request → parse options → evaluate policy → sign/execute → receipt
                                   ↑ ack-policy
```

### With v2 grants

When a v2 grant is available, the policy engine can verify:

- The payment's `recipient` matches the grant's `aud`
- The payment's `amount` is within the grant's `constraints.maxAmount`
- The payment's `currency` matches the grant's `constraints.currency`
- The grant's `scope` covers the payment action

The grant is the **owner's authorization**; the policy is the **runtime enforcement**. They're complementary — the grant says what's allowed in principle, the policy enforces it in practice (including cumulative limits the grant can't express as a single-transaction constraint).

### With dispute resolution

The policy engine and dispute resolution are two sides of the same coin:

- **Policy** prevents scope violations at runtime (before the payment)
- **Dispute evidence** proves scope violations after the fact (after the payment)

The `policyRef` in the evaluation result can be referenced in dispute evidence metadata. If a payment bypasses or overrides the policy, the absence of a `policyRef` in the receipt metadata is itself evidence.

The cost, stated openly: this coupling is informational, not cryptographic. A `policyRef` is not signed or verified by the dispute protocol — it's a breadcrumb for human resolvers, not a machine-verifiable claim. Making it verifiable would require the policy evaluation itself to be a signed artifact, which is a harder problem.

## Phases

### Phase 1: Core engine (parity+ with demo)

- `definePolicy` and `evaluate` with per-transaction constraints
- Recipient allow/deny lists
- Currency allowlists
- In-memory store for testing
- 100% test coverage on the evaluation path
- Publish to npm as `ack-policy@0.1.0`

**Success criteria:** the payments demo can replace its built-in policy engine with `ack-policy` and pass all existing tests.

### Phase 2: Rolling window budgets

- `PolicyStore` interface with in-memory implementation
- Atomic check-and-reserve with idempotency keys
- Commit/release lifecycle
- Per-agent, per-currency window isolation
- Split-attack resistance tests (concurrent evaluations)

**Success criteria:** a test that runs N concurrent evaluations totaling more than the window limit, and exactly the right number are approved.

### Phase 3: Grant integration

- Parse v2 grant claims and cross-check against payment options
- Scope matching (space-delimited scope strings)
- Constraint extraction and comparison
- Audience verification

**Depends on:** v2 grants landing in ACK core (PR #179).

### Phase 4: Temporal rules and advanced constraints

- Time-of-day restrictions
- Rate limiting (max N transactions per window)
- Cooldown periods
- Category rules (when receipt/grant carry category)

### Phase 5: Persistent storage adapters

- Redis adapter (atomic via Lua scripts or MULTI/EXEC)
- SQLite adapter (for single-instance deployments)
- PostgreSQL adapter (for multi-instance)

## Open questions

1. **Should policy definitions be serializable?** If policies are JSON-serializable, they can be stored, versioned, and transmitted. If they allow function predicates (e.g. custom validation logic), they're more flexible but can't be serialized. The demo uses a plain object; starting with serializable and adding a `custom` escape hatch later is probably right.

2. **Should the library own the `policyRef` format?** A `policyRef` that's a content hash of the policy definition + evaluation timestamp would be deterministic and auditable. But it adds complexity, and the dispute protocol doesn't verify it. Start without it?

3. **Budget breach: `denied` or `approval_required`?** The demo's per-transaction cap returns `denied`, but issue #138 asks this exact question. `approval_required` lets a human override; `denied` is a hard stop. This could be configurable per-rule.

4. **Multi-option evaluation.** A payment request can have multiple options. Should the policy evaluate all options and return the best one that passes? Or evaluate a single option the caller selects? The demo evaluates one at a time.

5. **Should the policy engine emit events?** An `onDenied`, `onApprovalRequired`, `onBudgetThreshold` event stream would be useful for monitoring. But it's scope creep for Phase 1.
