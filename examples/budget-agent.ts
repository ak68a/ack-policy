/**
 * Example: an agent with a rolling window budget.
 *
 * Demonstrates cumulative spend tracking and the commit/release lifecycle.
 *
 * Run: npx tsx examples/budget-agent.ts
 */
import { createMemoryStore, definePolicy, evaluate } from "../src/index.js"

const policy = definePolicy({
  maxAmount: {
    USDC: 10_000_000n, // 10.00 USDC per transaction
  },
  recipients: {
    allow: ["did:web:staples.com"],
  },
  budget: {
    windowMs: 24 * 60 * 60 * 1000, // 24-hour rolling window
    maxAmount: {
      USDC: 25_000_000n, // 25.00 USDC per day cumulative
    },
  },
})

const store = createMemoryStore()
const agentDid = "did:web:my-agent.com"

async function simulatePayment(id: string, amount: number) {
  const decision = await evaluate(policy, {
    paymentOption: {
      amount,
      currency: "USDC",
      decimals: 6,
      recipient: "did:web:staples.com",
    },
    agentDid,
    store,
    requestId: id,
  })

  const label = `${(amount / 1_000_000).toFixed(2)} USDC`
  console.log(`  ${id}: ${label} → ${decision.status}${"reason" in decision ? ` (${decision.reason})` : ""}`)

  if (decision.status === "approved") {
    // Simulate: payment succeeds
    await store.commit(`${id}:USDC`)
  }

  return decision
}

console.log("Budget demo: 25 USDC daily limit\n")

await simulatePayment("order-1", 8_000_000) // 8.00 — total: 8.00
await simulatePayment("order-2", 8_000_000) // 8.00 — total: 16.00
await simulatePayment("order-3", 8_000_000) // 8.00 — total: 24.00
await simulatePayment("order-4", 8_000_000) // 8.00 — total would be 32.00 → denied

console.log("\nSimulating a failed payment with release:\n")

const decision = await evaluate(policy, {
  paymentOption: {
    amount: 1_000_000,
    currency: "USDC",
    decimals: 6,
    recipient: "did:web:staples.com",
  },
  agentDid,
  store,
  requestId: "order-5",
})
console.log(`  order-5: 1.00 USDC → ${decision.status}`)

if (decision.status === "approved") {
  console.log("  order-5: payment failed, releasing reservation...")
  await store.release("order-5:USDC")

  const retry = await evaluate(policy, {
    paymentOption: {
      amount: 1_000_000,
      currency: "USDC",
      decimals: 6,
      recipient: "did:web:staples.com",
    },
    agentDid,
    store,
    requestId: "order-5-retry",
  })
  console.log(`  order-5-retry: 1.00 USDC → ${retry.status} (budget freed)`)
}
