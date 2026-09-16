# ack-policy

Policy engine for the [Agent Commerce Kit](https://github.com/agentcommercekit/ack) — enforce spend limits, category rules, recipient allowlists, and rolling time windows on agent payments.

> **Status: Coming soon.** This package is in the research and planning phase.

## What it does

When an AI agent makes payments on a user's behalf, the policy engine evaluates each payment request against the user's configured constraints before the payment executes. It answers one question: *is this payment within the scope the user authorized?*

- Per-transaction and rolling cumulative spend limits
- Currency-aware amount tracking (smallest subunit)
- Recipient allowlists and blocklists
- Category-based restrictions
- Time-windowed budgets (daily, weekly, monthly)

## Relationship to ACK

This is a companion package to `agentcommercekit`. It uses the published ACK SDK for identity and payment types but is maintained separately — the ACK maintainer considers runtime policy enforcement out of scope for the core protocol.

The policy engine complements the [dispute resolution extension](https://github.com/ak68a/ack-research/tree/main/dispute-resolution): grants define scope, policies enforce scope at runtime, disputes prove scope was violated after the fact.

## License

MIT
