/**
 * Shared domain types mirroring `contracts/keeper-registry/src/types.rs`.
 *
 * Kept in sync by hand for now (see design issue #221 — CLI-generated
 * bindings vs. a hand-written client). Any change to the contract's
 * `TaskType`/`TaskStatus` discriminants must be mirrored here.
 */

/**
 * The kind of automation a task represents. Mirrors the contract's
 * `TaskType` enum exactly, discriminant-for-discriminant — `register_task`
 * and `increase_reward` (and every method that echoes a task back) rely on
 * the numeric value matching what the contract expects on the wire, since a
 * simple (no-payload) `#[contracttype]` enum like this one is encoded as a
 * plain `u32` in the contract's ABI, not as a symbol.
 */
export enum TaskType {
  Liquidation = 0,
  OraclePricePush = 1,
  FundingRateUpdate = 2,
  LiquidityRebalance = 3,
  TtlExtension = 4,
  Custom = 5,
}

/** Lifecycle state of a task. Mirrors the contract's `TaskStatus` enum. */
export enum TaskStatus {
  Pending = 0,
  Claimed = 1,
  Executed = 2,
  Cancelled = 3,
  Expired = 4,
}
