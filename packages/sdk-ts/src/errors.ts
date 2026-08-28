/**
 * Typed decoding of the contract's error enum.
 *
 * Mirrors `contracts/keeper-registry/src/errors.rs` — `KeeperError` — by
 * hand for now (see design issue #221). Discriminants are part of the
 * published contract ABI and are never renumbered, so this mapping is
 * stable across contract versions that only append new variants.
 *
 * A full decoder for every documented failure mode (issue #235) is a
 * separate, larger piece of work covering every method in the SDK. This
 * file provides just enough of that machinery — the enum and the
 * message-pattern decoder — for the methods that ship in this change to
 * surface typed errors rather than raw strings.
 */

export enum KeeperError {
  AlreadyInitialized = 1,
  Unauthorized = 2,
  ContractPaused = 3,
  TaskNotFound = 4,
  InvalidTaskStatus = 5,
  DeadlinePassed = 6,
  DeadlineNotPassed = 7,
  InvalidReward = 8,
  LockPeriodActive = 9,
  InvalidFeeBps = 10,
  NotTaskOwner = 11,
  NotTaskClaimer = 12,
  NoRewardsAvailable = 13,
  ProofTooLarge = 14,
  NotInitialized = 15,
  TtlTooShort = 16,
  CalldataTooLarge = 17,
  InvalidTaskParams = 18,
  ArithmeticOverflow = 19,
  IncompatibleVerifierInterface = 20,
  BatchTooLarge = 21,
  EmptyBatch = 22,
  BatchRewardCeilingExceeded = 23,
}

/**
 * Raised for every failure the SDK surfaces — both a contract error decoded
 * off a simulation/submission failure (`code` set) and a client-side
 * rejection of an input the contract itself would also reject, thrown
 * before a transaction is even built (`code` set to the same enum, `cause`
 * left `undefined` since nothing was submitted).
 */
export class KeeperSdkError extends Error {
  /** The decoded contract error, when one could be identified. */
  readonly code?: KeeperError;
  /** The underlying error (RPC response, thrown value) this wraps, if any. */
  readonly cause?: unknown;

  constructor(message: string, code?: KeeperError, cause?: unknown) {
    super(message);
    this.name = "KeeperSdkError";
    this.code = code;
    this.cause = cause;
  }
}

// Soroban RPC surfaces a failed contract call as a host error message
// containing `Error(Contract, #<code>)` — both in `simulateTransaction`'s
// `.error` string and, stringified, in a failed `getTransaction` result.
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

/**
 * Extracts a `KeeperError` from a raw Soroban RPC error message, if the
 * message contains one. Returns `undefined` for messages that don't match
 * the pattern (transport errors, timeouts, an unrecognized error code) —
 * callers should fall back to surfacing the raw message in that case.
 */
export function decodeContractErrorCode(message: string | undefined | null): KeeperError | undefined {
  if (!message) {
    return undefined;
  }
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  return KeeperError[code] !== undefined ? (code as KeeperError) : undefined;
}
