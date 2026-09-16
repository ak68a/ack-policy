# ACK Ecosystem Project

Part of the [Agent Commerce Kit](https://github.com/agentcommercekit/ack) ecosystem. This package extends ACK with capabilities the maintainer considers out of scope for the core monorepo.

## Contribution pattern

All contributions to the upstream ACK repo follow: **Issue → PR → Merge**. The maintainer (Matt Venables, `venables`) guards scope tightly and reviews design before implementation.

- Open an issue to plant the idea and gauge interest before writing a full PR
- RFCs and specs go in the `ack-research` repo first as working drafts
- PRs to the ACK repo carry RFC-level docs under `docs/`, not just code
- Disclose AI usage in every PR and issue body per ACK's [AI_POLICY.md](https://github.com/agentcommercekit/ack/blob/main/AI_POLICY.md)

## Matt-style review

Before submitting anything to the ACK repo, run a self-review with these criteria (derived from the maintainer's observed review patterns):

1. **Scope** — Is this the right time? Does it depend on things that haven't shipped? Would Matt say "this is premature" or "out of scope"?
2. **Mechanical verifiability** — Can every claim be checked without human judgment or external callbacks? If not, say so explicitly.
3. **Cost statements** — Every design choice with a downside needs "The cost, stated openly: ..." — don't hide tradeoffs.
4. **No unused abstractions** — "We only add abstractions once something needs them." Don't build for hypothetical future requirements.
5. **Consistency with v2 RFC** — Use the same terminology, conventions (RFC 2119 keywords, claim tables with requiredness columns, numbered verification checklists), and extension pattern (core + ext-*).
6. **Internal consistency** — Section numbering, cross-references, and claim table entries must all agree. Stale references are bugs.
7. **Working examples** — Include a running code example using `jose` (not the ACK SDK) to prove implementability with stock libraries.

## This package

ack-policy is the runtime enforcement layer for agent payment constraints. Where ACK grants define what an agent is authorized to do (scope, amount limits, audience), this package evaluates payment requests against those constraints before the payment executes.

Key capabilities: per-transaction caps, rolling cumulative spend limits (windowed by day/week/month), category-based rules, recipient allowlists, and currency-aware amount tracking in smallest subunits.

It complements the dispute resolution extension: disputes prove scope was violated *after the fact*; the policy engine prevents violations *at runtime*. Together they form the enforcement + evidence pair.
