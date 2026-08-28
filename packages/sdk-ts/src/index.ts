/**
 * `@soroban-keeper-network/sdk-ts` — typed TypeScript client for the
 * Soroban Keeper Network registry contract.
 *
 * This module is the package's only supported entry point. Importing it
 * loads every method module, which is what attaches the typed
 * `client.registerTask()` / `client.increaseReward()` / … methods to
 * `KeeperRegistryClient` (see `client.ts` for why they are organised that
 * way). Deep-importing `./client` on its own gets you a client with none of
 * them.
 */

// Side-effect imports: each module attaches one method to the client's
// prototype and augments its type. Keep this list alphabetical, and keep
// it complete — a method module that is never imported is a method that
// type-checks and then throws "is not a function" at runtime.
import "./methods/increaseReward";
import "./methods/registerTask";

export { KeeperRegistryClient } from "./client";
export type { KeeperRegistryClientOptions } from "./client";

export { KeeperError, KeeperSdkError, decodeContractErrorCode } from "./errors";
export { TaskStatus, TaskType } from "./types";
export {
  MAX_CALLDATA_LEN,
  MAX_LOCK_LEDGERS,
  MIN_LOCK_LEDGERS,
  MIN_TTL_LEDGERS,
} from "./constants";

export type { IncreaseRewardParams } from "./methods/increaseReward";
export type { RegisterTaskParams } from "./methods/registerTask";
