# API Reference

## Functions

### `definePolicy(config)`

Creates a policy from a configuration object. The returned policy is immutable — to change constraints, create a new one.

```typescript
import { definePolicy } from "ack-policy"

const policy = definePolicy({
  maxAmount: { USDC: 5_000_000n },
  recipients: { allow: ["did:web:merchant.com"] },
})
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `PolicyConfig` | The policy configuration |

**Returns:** `Policy`

**Throws:** if the config is invalid (negative amounts, both `allow` and `deny` on recipients, empty amount map).

---

### `evaluate(policy, options)`

Evaluates a single payment option against a policy. Returns a `Promise<PolicyDecision>`.

```typescript
import { evaluate } from "ack-policy"

const decision = await evaluate(policy, { paymentOption })
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `policy` | `Policy` | A policy created by `definePolicy` |
| `options` | `EvaluateOptions` | The payment to evaluate |

**Returns:** `Promise<PolicyDecision>`

Evaluation checks run in this order. The first failure determines the decision:

1. **Amount validation** — the amount must parse as a positive bigint. If not: `denied`.
2. **Currency check** — the currency must have a configured limit in `maxAmount`. If not: `denied`.
3. **Amount limit** — the amount must be ≤ the per-currency limit. If not: `denied`.
4. **Recipient check** — the recipient is checked against the allowlist or denylist. If not allowed: `approval_required`. If explicitly denied: `denied`.
5. **Budget check** — if the policy has a `budget` and a `store` is provided, checks cumulative spend in the rolling window. If over budget: `denied`.

If all checks pass: `approved`.

---

## Types

### `PolicyConfig`

The input to `definePolicy`.

```typescript
interface PolicyConfig {
  maxAmount: Record<string, bigint>
  recipients?: RecipientRules
  budget?: BudgetConfig
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `maxAmount` | `Record<string, bigint>` | Yes | Per-currency spend limits in smallest subunits. Keys are currency codes (e.g. `"USDC"`, `"USD"`). A currency not listed here is denied. |
| `recipients` | `RecipientRules` | No | Recipient allowlist or denylist. If omitted, all recipients return `approval_required`. |
| `budget` | `BudgetConfig` | No | Rolling window budget. When set, `evaluate` requires `agentDid` and `store` in options. |

---

### `RecipientRules`

Controls which recipients can be paid autonomously. Use `allow` or `deny`, not both.

```typescript
type RecipientRules =
  | { allow: string[] }
  | { deny: string[] }
```

**With `allow`:** Recipients in the list are approved. All others return `approval_required`.

**With `deny`:** Recipients in the list are `denied`. All others are approved (assuming other checks pass).

**Why `approval_required` instead of `denied` for unknown recipients?** A recipient not on the allowlist isn't necessarily malicious — the user may have forgotten to add them. `approval_required` lets a human override. An explicit denylist entry is a hard block.

---

### `BudgetConfig`

Rolling window budget configuration.

```typescript
interface BudgetConfig {
  windowMs: number
  maxAmount: Record<string, bigint>
}
```

| Field | Type | Description |
|-------|------|-------------|
| `windowMs` | `number` | Rolling window duration in milliseconds (e.g. `86_400_000` for 24 hours). |
| `maxAmount` | `Record<string, bigint>` | Per-currency cumulative spend limits for the window. Currencies not listed here have no budget constraint (per-transaction limits still apply). |

---

### `EvaluateOptions`

The input to `evaluate`.

```typescript
interface EvaluateOptions {
  paymentOption: PaymentOption
  agentDid?: string
  store?: PolicyStore
  requestId?: string
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paymentOption` | `PaymentOption` | Yes | A payment option from an ACK payment request. Uses the `amount`, `currency`, and `recipient` fields. |
| `agentDid` | `string` | When budget | The agent's DID. Used to isolate budget tracking per agent. |
| `store` | `PolicyStore` | When budget | Storage adapter for cumulative budget tracking. |
| `requestId` | `string` | No | Idempotency key. Same `requestId` won't double-count against the budget. The store key is `${requestId}:${currency}`. |

`PaymentOption` is re-exported from `agentcommercekit`:

```typescript
type PaymentOption = {
  id: string
  amount: number | string
  decimals: number
  currency: string
  recipient: string
  network?: string
  paymentService?: string
  receiptService?: string
}
```

---

### `Policy`

The return type of `definePolicy`. Opaque — pass it to `evaluate`. Do not construct directly.

---

### `PolicyDecision`

The return type of `evaluate`.

```typescript
type PolicyDecision =
  | { status: "approved" }
  | { status: "approval_required"; reason: string }
  | { status: "denied"; reason: string }
```

| Status | Meaning | Agent action |
|--------|---------|-------------|
| `approved` | All constraints satisfied | Execute the payment |
| `approval_required` | Soft constraint not met (e.g. unknown recipient) | Ask the human |
| `denied` | Hard constraint violated (amount, currency, denylist) | Do not execute |

Non-approved decisions always include a `reason` string describing which constraint was not met.

---

### `PolicyStore`

Interface for budget state storage. Implement this to use a persistent backend (Redis, Postgres, etc.). Use `createMemoryStore()` for testing and single-instance agents.

```typescript
interface PolicyStore {
  checkAndReserve(params: CheckAndReserveParams): Promise<ReservationResult>
  commit(idempotencyKey: string): Promise<void>
  release(idempotencyKey: string): Promise<void>
}
```

| Method | Description |
|--------|-------------|
| `checkAndReserve` | Atomically check if the budget allows the payment and reserve the amount. Must be atomic to prevent split attacks. |
| `commit` | Mark a reservation as permanent (payment succeeded). |
| `release` | Free a reservation (payment failed). Does nothing if already committed. |

---

### `CheckAndReserveParams`

```typescript
interface CheckAndReserveParams {
  key: string              // e.g. "did:web:agent.com:USDC"
  amount: bigint
  limit: bigint
  windowMs: number
  idempotencyKey: string   // e.g. "req-123:USDC"
}
```

---

### `ReservationResult`

```typescript
interface ReservationResult {
  allowed: boolean
  currentTotal: bigint
  windowResetAt: Date
}
```

---

## Functions (continued)

### `createMemoryStore()`

Creates an in-memory `PolicyStore`. Suitable for testing and single-instance agents. State is lost on process restart.

```typescript
import { createMemoryStore } from "ack-policy"

const store = createMemoryStore()
```

**Returns:** `PolicyStore`
