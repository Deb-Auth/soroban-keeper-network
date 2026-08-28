/**
 * `client.increaseReward` — typed wrapper around the contract's
 * `increase_reward`. See `contracts/keeper-registry/src/task.rs` for the
 * on-chain implementation this mirrors.
 */

import { nativeToScVal } from "@stellar/stellar-sdk";
import { KeeperRegistryClient } from "../client";
import { KeeperError, KeeperSdkError } from "../errors";

export interface IncreaseRewardParams {
  /** Address that registered the task; must be this client's configured signer. */
  owner: string;
  /** Id of the task to top up. */
  taskId: bigint | number;
  /** Additional amount to escrow, in the reward token's smallest unit. Must be positive. */
  additional: bigint;
}

declare module "../client" {
  interface KeeperRegistryClient {
    /**
     * Tops up the bounty on a task that has not yet finished (`Pending` or
     * `Claimed`) by escrowing `additional` from `owner`. Signs and submits
     * with this client's configured signer, which must be `owner`.
     *
     * @throws {KeeperSdkError} client-side, before any transaction is
     *   built, when `additional` is non-positive — the same check
     *   `increase_reward` performs on-chain. A task in the wrong status, or
     *   owned by someone else, is still only caught by the contract, since
     *   this client cannot cheaply know a task's current state without an
     *   extra read.
     */
    increaseReward(params: IncreaseRewardParams): Promise<void>;
  }
}

KeeperRegistryClient.prototype.increaseReward = async function (
  this: KeeperRegistryClient,
  params: IncreaseRewardParams
): Promise<void> {
  this.requireSignerIs(params.owner, "owner");
  if (params.additional <= 0n) {
    throw new KeeperSdkError("additional must be positive", KeeperError.InvalidReward);
  }

  await this.invokeContract("increase_reward", [
    nativeToScVal(params.owner, { type: "address" }),
    nativeToScVal(BigInt(params.taskId), { type: "u64" }),
    nativeToScVal(params.additional, { type: "i128" }),
  ]);
};
