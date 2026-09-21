# Architecture

## Where ack-policy sits

ACK defines two signed artifacts: a **grant** (what the user authorized the agent to do) and a **receipt** (what the agent actually did). The grant is the authorization. The receipt is the record.

ack-policy sits between them — at the moment the agent decides whether to act.

```
                    ack-policy
                        ↓
User → Grant → Agent → [evaluate] → Payment → Receipt
       (scope)         (enforce)     (action)   (record)
```

The policy engine doesn't create or modify either artifact. It reads the payment request, compares it against the user's configured constraints, and returns a decision. If the decision is `approved`, the agent proceeds to payment. If not, it doesn't.

## Three layers of agent payment safety

| Layer | When | What it does | Package |
|-------|------|-------------|---------|
| **Authorization** | Before deployment | Defines what the agent *may* do — scope, audience, expiry | ACK grants (core) |
| **Enforcement** | At runtime, before payment | Prevents what the agent *shouldn't* do — amount limits, recipient rules, budgets | **ack-policy** |
| **Evidence** | After payment, if disputed | Proves what the agent *did* do — structured mismatch between grant and receipt | [ext-disputes proposal](https://github.com/agentcommercekit/ack/issues/217) |

Authorization and evidence are protocol-level concerns — they produce signed artifacts that third parties can verify. Enforcement is an application-level concern — it runs inside the agent's process and has no cryptographic output.

This is a deliberate design choice. Making enforcement a signed artifact (a "policy decision record") would strengthen dispute evidence but would also add an artifact to every payment's forward flow. The current design keeps enforcement lightweight and stateless for per-transaction checks.

## Why not part of ACK core?

The ACK maintainer [considers runtime policy enforcement out of scope](https://github.com/agentcommercekit/ack/issues/138) for the core protocol. The reasoning: ACK defines the artifact shapes and verification rules. What an agent does with those artifacts before deciding to pay is application logic.

This is the right boundary. A policy engine has opinions about storage, concurrency, configuration format, and decision semantics that don't belong in a protocol library. Keeping it separate means:

- ACK stays focused on artifact creation and verification
- ack-policy can evolve independently (new rule types, storage adapters)
- Consumers who don't need policy enforcement don't pay for it
- The policy API surface can break without breaking the protocol

## Design decisions

### Three-valued decisions, not two

Most policy systems return allow/deny. ack-policy adds `approval_required` — the payment isn't pre-authorized, but it's not forbidden either.

The motivating case: a recipient the user didn't explicitly allowlist. Denying it outright means the agent can never pay a new merchant without the user updating the policy first. Approving it silently defeats the purpose of having a policy. `approval_required` lets the agent ask.

### Per-currency limits, not a single threshold

USD has 2 decimal places. USDC has 6. ETH has 18. A threshold of `500` means $5.00 in USD cents, $0.000500 in USDC micro-units, and an astronomically small amount in ETH wei.

Every limit is keyed by currency code and expressed in that currency's smallest subunit. There is no cross-currency conversion — the policy engine doesn't know exchange rates, and embedding them would introduce a stale-price attack surface.

### Evaluation order is defined

Checks run in a fixed order: amount validation → currency check → amount limit → recipient check. The first failure determines the decision.

This matters because different failures produce different decision types. An amount over the cap is `denied` (hard constraint). An unknown recipient is `approval_required` (soft constraint). If both fail, the agent should see `denied`, not `approval_required` — the hard constraint takes priority.

### Stateless for per-transaction checks

Phase 1 evaluation is a pure function: same inputs, same output, no side effects. There's no store, no state, no async. This makes it trivially testable and safe to call from any context.

State arrives in Phase 2 (rolling window budgets), where `evaluate` gains an optional store parameter and becomes async. Per-transaction checks remain synchronous — the store is only consulted for cumulative budget rules.
