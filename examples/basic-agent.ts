/**
 * Example: an agent that evaluates payment requests against a policy.
 *
 * Run: npx tsx examples/basic-agent.ts
 */
import { definePolicy, evaluate } from "../src/index.js"

const policy = definePolicy({
  maxAmount: {
    USDC: 10_000_000n, // 10.00 USDC per transaction
    USD: 1_000n, // 10.00 USD per transaction
  },
  recipients: {
    allow: ["did:web:staples.com", "did:web:amazon.com"],
  },
})

// Simulate payment options from a merchant's payment request
const paymentOptions = [
  {
    id: "opt-1",
    amount: 3_500_000,
    decimals: 6,
    currency: "USDC",
    recipient: "did:web:staples.com",
  },
  {
    id: "opt-2",
    amount: 25_000_000,
    decimals: 6,
    currency: "USDC",
    recipient: "did:web:staples.com",
  },
  {
    id: "opt-3",
    amount: 500,
    decimals: 2,
    currency: "USD",
    recipient: "did:web:unknown-vendor.com",
  },
]

console.log("Policy evaluation results:\n")

for (const option of paymentOptions) {
  const decision = evaluate(policy, { paymentOption: option })

  console.log(`  ${option.id} — ${option.amount} ${option.currency} to ${option.recipient}`)
  console.log(`    → ${decision.status}${"reason" in decision ? `: ${decision.reason}` : ""}`)
  console.log()
}

// Expected output:
//   opt-1 — 3500000 USDC to did:web:staples.com
//     → approved
//
//   opt-2 — 25000000 USDC to did:web:staples.com
//     → denied: Payment amount exceeds the autonomous spend limit
//
//   opt-3 — 500 USD to did:web:unknown-vendor.com
//     → approval_required: Recipient is not on the autonomous payment allowlist
