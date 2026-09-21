export interface PolicyConfig {
  maxAmount: Record<string, bigint>
  recipients?: RecipientRules
}

export type RecipientRules =
  | { allow: string[]; deny?: never }
  | { deny: string[]; allow?: never }

export interface Policy {
  readonly maxAmount: ReadonlyMap<string, bigint>
  readonly recipients: Readonly<RecipientRules> | null
}

export interface EvaluateOptions {
  paymentOption: {
    amount: number | string
    currency: string
    recipient: string
    [key: string]: unknown
  }
}

export type PolicyDecision =
  | { status: "approved" }
  | { status: "approval_required"; reason: string }
  | { status: "denied"; reason: string }
