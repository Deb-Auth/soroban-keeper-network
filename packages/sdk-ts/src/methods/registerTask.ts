/**
 * `client.registerTask` — typed wrapper around the contract's
 * `register_task`. See `contracts/keeper-registry/src/task.rs` for the
 * on-chain implementation this mirrors.
 */

import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { KeeperRegistryClient } from "../client";
import {
  MAX_CALLDATA_LEN,
  MAX_LOCK_LEDGERS,
  MIN_LOCK_LEDGERS,
  MIN_TTL_LEDGERS,
} from "../constants";
import { KeeperError, KeeperSdkError } from "../errors";
import { TaskType } from "../types";

export interface RegisterTaskParams {
  /** Address funding the task; must be this client's configured signer. */
  owner: string;
  /** Classification of the automation this task represents. */
  taskType: TaskType;
  /** Encoded params a keeper uses to reconstruct the target call. Capped at 1024 bytes on-chain (`MAX_CALLDATA_LEN`). */
  calldata: Uint8Array | Buffer;
  /** Reward escrowed as bounty, in the reward token's smallest unit (stroops for XLM). Must be positive. */
  reward: bigint;
  /** Unix timestamp (seconds) after which the task may be expired. Must be in the future. */
  deadline: bigint | number;
  /** Ledgers the task's storage entry is kept alive for. Must be at least `MIN_TTL_LEDGERS` (1,000) on-chain. */
  ttlLedgers: number;
  /** Ledgers a claiming keeper holds exclusive rights before re-claim is allowed. Must fall within `[MIN_LOCK_LEDGERS, MAX_LOCK_LEDGERS]` (12–17,280) on-chain. */
  lockLedgers: number;
  /**
   * Optional execution verifier address.
   *
   * Not yet accepted by `register_task` on current `main` — the contract's
   * verifier support (epic E04) has not shipped as of this SDK method (see
   * issue #238, which is gated on that epic). The field exists so this
   * method's signature does not need a breaking change once it does; until
   * then, passing a `verifier` is rejected client-side rather than silently
   * dropped, since silently ignoring it would let a caller believe a task
   * is verified when it is not.
   */
  verifier?: string;
}

declare module "../client" {
  interface KeeperRegistryClient {
    /**
     * Registers a new task, escrowing `reward` from `owner` into the
     * contract. Signs and submits with this client's configured signer,
     * which must be `owner`.
     *
     * @returns The new task's id.
     * @throws {KeeperSdkError} client-side, before any transaction is built,
     *   for the same cheaply-checkable invalid inputs `register_task` itself
     *   rejects (non-positive reward, a deadline not in the future, an
     *   out-of-range `ttlLedgers`/`lockLedgers`) — see `KeeperError` for the
     *   full set the contract may also reject with post-submission.
     */
    registerTask(params: RegisterTaskParams): Promise<bigint>;
  }
}

KeeperRegistryClient.prototype.registerTask = async function (
  this: KeeperRegistryClient,
  params: RegisterTaskParams
): Promise<bigint> {
  this.requireSignerIs(params.owner, "owner");
  validateRegisterTaskParams(params);

  const deadline = BigInt(params.deadline);
  const response = await this.invokeContract("register_task", [
    nativeToScVal(params.owner, { type: "address" }),
    nativeToScVal(params.taskType, { type: "u32" }),
    nativeToScVal(Buffer.from(params.calldata), { type: "bytes" }),
    nativeToScVal(params.reward, { type: "i128" }),
    nativeToScVal(deadline, { type: "u64" }),
    nativeToScVal(params.ttlLedgers, { type: "u32" }),
    nativeToScVal(params.lockLedgers, { type: "u32" }),
  ]);

  if (!response.returnValue) {
    // `register_task` always returns the new id, so an absent return value
    // means the response did not come from the contract we think it did —
    // worth saying so rather than handing back a confusing `undefined`.
    throw new KeeperSdkError("register_task returned no value; expected the new task id");
  }
  return scValToNative(response.returnValue) as bigint;
};

/**
 * Client-side pre-flight checks mirroring `validate_task_params` in
 * `contracts/keeper-registry/src/internal.rs`. These are an optimization —
 * catching a doomed call before it costs a round trip — not a replacement
 * for the contract's own validation, which remains authoritative (e.g. it
 * also checks a configured `MinReward` floor this client cannot see without
 * an extra read).
 */
function validateRegisterTaskParams(params: RegisterTaskParams): void {
  if (params.verifier !== undefined) {
    throw new KeeperSdkError(
      "verifier is not yet supported by register_task on this contract build (epic E04 has not shipped) — omit it"
    );
  }
  if (params.reward <= 0n) {
    throw new KeeperSdkError("reward must be positive", KeeperError.InvalidReward);
  }
  if (BigInt(params.deadline) <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new KeeperSdkError("deadline must be in the future", KeeperError.DeadlinePassed);
  }
  if (params.calldata.length > MAX_CALLDATA_LEN) {
    throw new KeeperSdkError(
      `calldata is ${params.calldata.length} bytes, over the ${MAX_CALLDATA_LEN}-byte limit`,
      KeeperError.CalldataTooLarge
    );
  }
  if (params.lockLedgers < MIN_LOCK_LEDGERS || params.lockLedgers > MAX_LOCK_LEDGERS) {
    throw new KeeperSdkError(
      `lockLedgers must be within [${MIN_LOCK_LEDGERS}, ${MAX_LOCK_LEDGERS}]`,
      KeeperError.InvalidTaskParams
    );
  }
  if (params.ttlLedgers < MIN_TTL_LEDGERS) {
    throw new KeeperSdkError(
      `ttlLedgers must be at least ${MIN_TTL_LEDGERS}`,
      KeeperError.InvalidTaskParams
    );
  }
}
