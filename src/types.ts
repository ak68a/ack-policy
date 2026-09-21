export interface PolicyConfig {
  maxAmount: Record<string, bigint>
  recipients?: RecipientRules
  budget?: BudgetConfig
}

export interface BudgetConfig {
  windowMs: number
  maxAmount: Record<string, bigint>
}

export type RecipientRules =
  | { allow: string[]; deny?: never }
  | { deny: string[]; allow?: never }

export interface Policy {
  readonly maxAmount: ReadonlyMap<string, bigint>
  readonly recipients: Readonly<RecipientRules> | null
  readonly budget: Readonly<{
    windowMs: number
    maxAmount: ReadonlyMap<string, bigint>
  }> | null
}

export interface EvaluateOptions {
  paymentOption: {
    amount: number | string
    currency: string
    recipient: string
    [key: string]: unknown
  }
  agentDid?: string
  store?: PolicyStore
  requestId?: string
}

export type PolicyDecision =
  | { status: "approved" }
  | { status: "approval_required"; reason: string }
  | { status: "denied"; reason: string }

export interface CheckAndReserveParams {
  key: string
  amount: bigint
  limit: bigint
  windowMs: number
  idempotencyKey: string
}

export interface ReservationResult {
  allowed: boolean
  currentTotal: bigint
  windowResetAt: Date
}

export interface PolicyStore {
  checkAndReserve(params: CheckAndReserveParams): Promise<ReservationResult>
  commit(idempotencyKey: string): Promise<void>
  release(idempotencyKey: string): Promise<void>
}
