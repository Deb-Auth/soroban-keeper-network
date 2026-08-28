/**
 * `client.claimTask` — typed wrapper around the contract's permissionless
 * `claim_task`. See `contracts/keeper-registry/src/task.rs` for the
 * on-chain implementation this mirrors.
 */

import { nativeToScVal } from "@stellar/stellar-sdk";
import { KeeperRegistryClient } from "../client";
import { KeeperError, KeeperSdkError } from "../errors";

export interface ClaimTaskParams {
  /** Address claiming the task; must be this client's configured signer. */
  keeper: string;
  /** Id of the task to claim. */
  taskId: bigint | number;
}

/**
 * Result of a `claimTask` call. The two documented rejections a keeper bot
 * needs to tell apart from a hard failure — someone else currently holds
 * the claim (`lock_period_active`, worth re-scanning for other tasks) versus
 * the task's deadline has already passed (`deadline_passed`, this task is
 * dead, stop retrying it) — are returned as a typed outcome instead of a
 * thrown error. Every other failure (task not found, contract paused, an
 * already-terminal task) still throws a `KeeperSdkError`, since those are
 * not part of normal claim-racing behaviour.
 */
export type ClaimTaskOutcome =
  | { status: "claimed" }
  | { status: "lock_period_active" }
  | { status: "deadline_passed" };

declare module "../client" {
  interface KeeperRegistryClient {
    /**
     * Claims `taskId` for `keeper`, locking out other keepers for the
     * task's `lock_ledgers` window. Permissionless: any account may attempt
     * to claim a `Pending` task, or a `Claimed` one whose previous
     * claimer's lock has lapsed.
     */
    claimTask(params: ClaimTaskParams): Promise<ClaimTaskOutcome>;
  }
}

KeeperRegistryClient.prototype.claimTask = async function (
  this: KeeperRegistryClient,
  params: ClaimTaskParams
): Promise<ClaimTaskOutcome> {
  this.requireSignerIs(params.keeper, "keeper");

  try {
    await this.invokeContract("claim_task", [
      nativeToScVal(params.keeper, { type: "address" }),
      nativeToScVal(BigInt(params.taskId), { type: "u64" }),
    ]);
    return { status: "claimed" };
  } catch (err) {
    if (err instanceof KeeperSdkError) {
      if (err.code === KeeperError.LockPeriodActive) {
        return { status: "lock_period_active" };
      }
      if (err.code === KeeperError.DeadlinePassed) {
        return { status: "deadline_passed" };
      }
    }
    throw err;
  }
};
