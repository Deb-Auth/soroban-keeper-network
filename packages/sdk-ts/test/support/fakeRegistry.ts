/**
 * A tiny in-memory stand-in for the registry's task state machine, so tests
 * for the lifecycle methods can exercise real preconditions — "a Pending
 * task", "a Claimed task whose lock has lapsed" — instead of asserting that
 * a hard-coded error maps to a hard-coded outcome.
 *
 * Scope, deliberately narrow: it models only the guards the methods under
 * test claim to distinguish, taken from `contracts/keeper-registry/src/task.rs`.
 * It knows nothing about escrow, fees, auth, pausing, or storage TTL. A fake
 * that reimplemented the contract would only ever prove itself right, so the
 * authority on contract behaviour stays the Rust test suite, with the SDK's
 * own end-to-end coverage tracked as issue #249. Each lifecycle method added
 * to the SDK extends `invoke` with the one call it needs, and no more.
 */

import { Keypair, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { KeeperError, KeeperRegistryClient, KeeperSdkError, TaskStatus } from "../../src/index";
import { TEST_CONTRACT_ID, TEST_NETWORK_PASSPHRASE, UNUSED_RPC_URL } from "./stubClient";

export interface FakeTask {
  owner: string;
  status: TaskStatus;
  claimer?: string;
  /** Ledger sequence at claim time, mirroring the contract's `claim_ledger`. */
  claimLedger?: number;
  lockLedgers: number;
  /** Unix timestamp (seconds), mirroring the contract's `deadline`. */
  deadline: bigint;
}

export interface SeedTaskOptions {
  owner?: string;
  status?: TaskStatus;
  claimer?: string;
  claimLedger?: number;
  lockLedgers?: number;
  deadline?: bigint;
}

export class FakeRegistry {
  /** Current ledger sequence, against which lock windows are measured. */
  ledgerSequence = 100_000;
  /** Current ledger timestamp in seconds, against which deadlines are measured. */
  timestamp = BigInt(Math.floor(Date.now() / 1000));

  private readonly tasks = new Map<string, FakeTask>();
  private nextId = 1n;

  /** Adds a task and returns its id. Defaults describe a fresh Pending task. */
  seedTask(options: SeedTaskOptions = {}): bigint {
    const id = this.nextId++;
    this.tasks.set(id.toString(), {
      owner: options.owner ?? Keypair.random().publicKey(),
      status: options.status ?? TaskStatus.Pending,
      claimer: options.claimer,
      claimLedger: options.claimLedger,
      lockLedgers: options.lockLedgers ?? 120,
      deadline: options.deadline ?? this.timestamp + 3600n,
    });
    return id;
  }

  task(id: bigint): FakeTask {
    const task = this.tasks.get(id.toString());
    assertFound(task, id);
    return task;
  }

  /** Advances the ledger far enough that `id`'s claim lock has lapsed. */
  lapseLockOf(id: bigint): void {
    const task = this.task(id);
    this.ledgerSequence = (task.claimLedger ?? this.ledgerSequence) + task.lockLedgers;
  }

  /** Moves the ledger clock past `id`'s deadline. */
  passDeadlineOf(id: bigint): void {
    this.timestamp = this.task(id).deadline + 1n;
  }

  /**
   * Dispatches a contract call, either mutating state or throwing the
   * `KeeperSdkError` the SDK would have built from the RPC failure — the
   * same shape `KeeperRegistryClient.invokeContract` raises, so the method
   * under test sees exactly what it would in production.
   */
  invoke(method: string, args: xdr.ScVal[]): rpc.Api.GetSuccessfulTransactionResponse {
    const native = args.map((arg) => scValToNative(arg));
    switch (method) {
      case "cancel_task":
        return this.cancelTask(native[0] as string, native[1] as bigint);
      case "claim_task":
        return this.claimTask(native[0] as string, native[1] as bigint);
      case "expire_task":
        return this.expireTask(native[0] as bigint);
      default:
        throw new Error(`FakeRegistry does not model ${method}`);
    }
  }

  private claimTask(keeper: string, id: bigint): rpc.Api.GetSuccessfulTransactionResponse {
    const task = this.task(id);
    if (this.timestamp >= task.deadline) {
      throw contractError(KeeperError.DeadlinePassed);
    }
    if (task.status === TaskStatus.Claimed && !this.lockExpired(task)) {
      throw contractError(KeeperError.LockPeriodActive);
    }
    if (task.status !== TaskStatus.Pending && task.status !== TaskStatus.Claimed) {
      throw contractError(KeeperError.InvalidTaskStatus);
    }
    task.status = TaskStatus.Claimed;
    task.claimer = keeper;
    task.claimLedger = this.ledgerSequence;
    return voidResponse();
  }

  private cancelTask(owner: string, id: bigint): rpc.Api.GetSuccessfulTransactionResponse {
    const task = this.task(id);
    if (task.owner !== owner) {
      throw contractError(KeeperError.NotTaskOwner);
    }
    if (task.status === TaskStatus.Claimed && !this.lockExpired(task)) {
      throw contractError(KeeperError.LockPeriodActive);
    }
    if (task.status !== TaskStatus.Pending && task.status !== TaskStatus.Claimed) {
      throw contractError(KeeperError.InvalidTaskStatus);
    }
    task.status = TaskStatus.Cancelled;
    return voidResponse();
  }

  private expireTask(id: bigint): rpc.Api.GetSuccessfulTransactionResponse {
    const task = this.task(id);
    if (task.status !== TaskStatus.Pending && task.status !== TaskStatus.Claimed) {
      throw contractError(KeeperError.InvalidTaskStatus);
    }
    if (this.timestamp < task.deadline) {
      throw contractError(KeeperError.DeadlineNotPassed);
    }
    task.status = TaskStatus.Expired;
    return voidResponse();
  }

  /**
   * Mirrors the contract's `lock_expired`: the boundary is inclusive, so at
   * `claim_ledger + lock_ledgers` exactly the lock is already lapsed.
   */
  private lockExpired(task: FakeTask): boolean {
    if (task.claimLedger === undefined) {
      return true;
    }
    return this.ledgerSequence >= task.claimLedger + task.lockLedgers;
  }
}

export interface RegistryBackedClient {
  client: KeeperRegistryClient;
  /** The account this client signs as. */
  address: string;
  /** Every contract method the client called, in order. */
  methods: string[];
}

/**
 * A client whose contract calls are answered by `registry`, signing as a
 * fresh random account unless `signer` is supplied.
 */
export function clientFor(registry: FakeRegistry, signer = Keypair.random()): RegistryBackedClient {
  const client = new KeeperRegistryClient({
    contractId: TEST_CONTRACT_ID,
    networkPassphrase: TEST_NETWORK_PASSPHRASE,
    signer,
    rpcUrl: UNUSED_RPC_URL,
  });

  const methods: string[] = [];
  client.invokeContract = async (method: string, args: xdr.ScVal[]) => {
    methods.push(method);
    return registry.invoke(method, args);
  };

  return { client, address: signer.publicKey(), methods };
}

function assertFound(task: FakeTask | undefined, id: bigint): asserts task is FakeTask {
  if (!task) {
    throw contractError(KeeperError.TaskNotFound, id);
  }
}

/** Builds the error the SDK produces for a contract-rejected simulation. */
function contractError(code: KeeperError, id?: bigint): KeeperSdkError {
  const subject = id === undefined ? "" : ` (task ${id})`;
  return new KeeperSdkError(
    `simulation failed${subject}: HostError: Error(Contract, #${code})`,
    code
  );
}

function voidResponse(): rpc.Api.GetSuccessfulTransactionResponse {
  return { returnValue: nativeToScVal(null) } as rpc.Api.GetSuccessfulTransactionResponse;
}
