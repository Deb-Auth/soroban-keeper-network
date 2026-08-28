/**
 * `client.expireTask` — typed wrapper around the contract's permissionless
 * `expire_task`. See `contracts/keeper-registry/src/task.rs` for the
 * on-chain implementation this mirrors.
 */

import { nativeToScVal } from "@stellar/stellar-sdk";
import { KeeperRegistryClient } from "../client";

export interface ExpireTaskParams {
  /** Id of the task to expire. */
  taskId: bigint | number;
  /**
   * Transaction source account. Needed only to build and submit the
   * transaction — unlike every other mutating method in this SDK,
   * `expire_task` requires no authorization relationship between `caller`
   * and the task at all, and the contract does not even take `caller` as
   * an argument (there is nothing for it to `require_auth()` against).
   *
   * In this SDK, a client is bound to one signer for its lifetime (see
   * `client.ts`), so `caller` must equal this client's configured signer;
   * it exists on this params object to keep that "any account" contract
   * semantics visible in the method's own type signature rather than
   * buried in prose. Calling as an address unrelated to a task's owner or
   * claimer means constructing the client with that address's signer —
   * there is no owner/keeper check to satisfy either way.
   */
  caller: string;
}

declare module "../client" {
  interface KeeperRegistryClient {
    /**
     * Expires `taskId` once its deadline has passed, refunding the
     * escrowed reward to the task's owner.
     *
     * Callable by any account — this is deliberate: it lets a stuck task
     * always be unwound and its funds recovered, even by a party with no
     * relationship to the task, such as a keeper bot expiring stale tasks
     * as a courtesy while scanning.
     */
    expireTask(params: ExpireTaskParams): Promise<void>;
  }
}

KeeperRegistryClient.prototype.expireTask = async function (
  this: KeeperRegistryClient,
  params: ExpireTaskParams
): Promise<void> {
  this.requireSignerIs(params.caller, "caller");

  await this.invokeContract("expire_task", [nativeToScVal(BigInt(params.taskId), { type: "u64" })]);
};
