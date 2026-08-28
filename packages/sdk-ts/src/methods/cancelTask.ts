/**
 * `client.cancelTask` — typed wrapper around the contract's owner-only
 * `cancel_task`. See `contracts/keeper-registry/src/task.rs` for the
 * on-chain implementation this mirrors.
 */

import { nativeToScVal } from "@stellar/stellar-sdk";
import { KeeperRegistryClient } from "../client";
import { KeeperError, KeeperSdkError } from "../errors";

export interface CancelTaskParams {
  /** Address that registered the task; must be this client's configured signer. */
  owner: string;
  /** Id of the task to cancel. */
  taskId: bigint | number;
}

/**
 * Result of a `cancelTask` call. `lock_period_active` and
 * `invalid_task_status` are kept distinct because they call for different
 * follow-up: a `Claimed` task whose lock has not yet lapsed can be
 * cancelled once it does (worth a retry later), while an
 * already-`Executed`/`Cancelled`/`Expired` task cannot ever be cancelled
 * (retrying is pointless). Every other failure (e.g. a caller who is not
 * the task's owner) still throws a `KeeperSdkError`.
 */
export type CancelTaskOutcome =
  | { status: "cancelled" }
  | { status: "lock_period_active" }
  | { status: "invalid_task_status" };

declare module "../client" {
  interface KeeperRegistryClient {
    /**
     * Cancels `taskId`, refunding its escrowed reward to `owner`.
     *
     * Accepts a task in either of two states, per the contract as it
     * stands on current `main` — this is not the older, narrower "Pending
     * only" rule:
     *   - `Pending` — cancellable immediately.
     *   - `Claimed` — cancellable once the claiming keeper's lock window
     *     has lapsed, so a keeper that has started work keeps exclusive
     *     time to execute before the owner can pull the escrow out from
     *     under it.
     *
     * Signs and submits with this client's configured signer, which must
     * be `owner`.
     */
    cancelTask(params: CancelTaskParams): Promise<CancelTaskOutcome>;
  }
}

KeeperRegistryClient.prototype.cancelTask = async function (
  this: KeeperRegistryClient,
  params: CancelTaskParams
): Promise<CancelTaskOutcome> {
  this.requireSignerIs(params.owner, "owner");

  try {
    await this.invokeContract("cancel_task", [
      nativeToScVal(params.owner, { type: "address" }),
      nativeToScVal(BigInt(params.taskId), { type: "u64" }),
    ]);
    return { status: "cancelled" };
  } catch (err) {
    if (err instanceof KeeperSdkError) {
      if (err.code === KeeperError.LockPeriodActive) {
        return { status: "lock_period_active" };
      }
      if (err.code === KeeperError.InvalidTaskStatus) {
        return { status: "invalid_task_status" };
      }
    }
    throw err;
  }
};
