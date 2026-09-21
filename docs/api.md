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

Evaluates a single payment option against a policy. Returns a decision synchronously.

```typescript
import { evaluate } from "ack-policy"

const decision = evaluate(policy, { paymentOption })
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `policy` | `Policy` | A policy created by `definePolicy` |
| `options` | `EvaluateOptions` | The payment to evaluate |

**Returns:** `PolicyDecision`

Evaluation checks run in this order. The first failure determines the decision:

1. **Amount validation** — the amount must parse as a positive bigint. If not: `denied`.
2. **Currency check** — the currency must have a configured limit in `maxAmount`. If not: `denied`.
3. **Amount limit** — the amount must be ≤ the per-currency limit. If not: `denied`.
4. **Recipient check** — the recipient is checked against the allowlist or denylist. If not allowed: `approval_required`. If explicitly denied: `denied`.

If all checks pass: `approved`.

---

## Types

### `PolicyConfig`

The input to `definePolicy`.

```typescript
interface PolicyConfig {
  maxAmount: Record<string, bigint>
  recipients?: RecipientRules
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `maxAmount` | `Record<string, bigint>` | Yes | Per-currency spend limits in smallest subunits. Keys are currency codes (e.g. `"USDC"`, `"USD"`). A currency not listed here is denied. |
| `recipients` | `RecipientRules` | No | Recipient allowlist or denylist. If omitted, all recipients return `approval_required`. |

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

### `EvaluateOptions`

The input to `evaluate`.

```typescript
interface EvaluateOptions {
  paymentOption: PaymentOption
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paymentOption` | `PaymentOption` | Yes | A payment option from an ACK payment request. Uses the `amount`, `currency`, and `recipient` fields. |

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
