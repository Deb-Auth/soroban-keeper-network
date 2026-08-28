/**
 * `KeeperRegistryClient` — the transaction-building core the SDK's typed
 * methods are built on.
 *
 * A full-surface client class is tracked separately as issue #222; this is
 * the minimal shape the state-mutating methods in this package need in
 * order to build, simulate, sign, submit, and confirm a call against a
 * deployed `KeeperRegistry`, and to turn a failure into a typed
 * `KeeperSdkError`.
 *
 * Each `client.<method>()` — `registerTask`, `claimTask`, … — lives in its
 * own module under `src/methods/` and attaches itself to this class's
 * prototype, rather than being written out here. That follows the
 * module-per-area convention CONTRIBUTING.md sets for the contract
 * (`task.rs`, `admin.rs`, `views.rs`, …): adding a method touches exactly
 * one new file, so two methods being written in parallel never collide.
 *
 * The trade-off is that a method exists at runtime only once its module has
 * been loaded. `src/index.ts` imports every method module and is the
 * package's only entry point (`main`/`types` both resolve to it), so any
 * caller using the package as published gets all of them. Importing
 * `./client` directly — from inside this package, or via a deep import —
 * does not, and is not supported.
 *
 * One client is bound to one signer for the lifetime of the instance,
 * mirroring `examples/keeper-bot`, which drives one `Keypair` per process.
 * A caller acting as more than one Stellar account constructs one client
 * per signer.
 */

import {
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { KeeperSdkError, decodeContractErrorCode } from "./errors";

/** Default transaction validity window, in seconds. */
const DEFAULT_TX_TIMEOUT_SECONDS = 30;
/** Default interval between confirmation polls, in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Default number of confirmation polls before giving up. */
const DEFAULT_MAX_POLL_ATTEMPTS = 30;

export interface KeeperRegistryClientOptions {
  /** Contract id of the deployed `KeeperRegistry` instance (`C...`). */
  contractId: string;
  /** Network passphrase, e.g. `Networks.TESTNET`. */
  networkPassphrase: string;
  /** Signs, and is the source account for, every transaction this client submits. */
  signer: Keypair;
  /** Soroban RPC endpoint URL. Required unless `server` is supplied. */
  rpcUrl?: string;
  /**
   * Pre-built RPC server. Takes precedence over `rpcUrl`, and is how tests
   * and callers needing a non-default `rpc.Server` configuration inject one.
   */
  server?: rpc.Server;
  /** Transaction validity window, in seconds. Defaults to 30. */
  txTimeoutSeconds?: number;
  /** Interval between confirmation polls, in milliseconds. Defaults to 2000. */
  pollIntervalMs?: number;
  /** Maximum number of confirmation polls before giving up. Defaults to 30. */
  maxPollAttempts?: number;
}

export class KeeperRegistryClient {
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly signer: Keypair;
  readonly server: rpc.Server;

  private readonly contract: Contract;
  private readonly txTimeoutSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: KeeperRegistryClientOptions) {
    const { rpcUrl, server } = options;
    if (!server && !rpcUrl) {
      throw new Error("KeeperRegistryClient requires either `server` or `rpcUrl`");
    }

    this.contractId = options.contractId;
    this.networkPassphrase = options.networkPassphrase;
    this.signer = options.signer;
    // `allowHttp` is derived from the URL rather than exposed as an option:
    // a plaintext endpoint is only ever a local development one, and making
    // it opt-in-by-URL means no caller can enable it for a remote host by
    // flipping a flag they didn't think about.
    this.server =
      server ?? new rpc.Server(rpcUrl as string, { allowHttp: (rpcUrl as string).startsWith("http://") });
    this.contract = new Contract(options.contractId);
    this.txTimeoutSeconds = options.txTimeoutSeconds ?? DEFAULT_TX_TIMEOUT_SECONDS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  /**
   * Builds, simulates, signs, submits, and confirms a call to `method`,
   * returning the confirmed transaction response — its `returnValue` holds
   * the contract function's return value, still as an `ScVal`.
   *
   * Every failure path throws a `KeeperSdkError` carrying the decoded
   * `KeeperError` when the underlying RPC message contained one, so callers
   * can branch on `err.code` instead of matching on message text.
   *
   * Internal to the package: method modules call it, and tests replace it
   * to exercise a method's own logic without a live network. It is not part
   * of the public API and may change without a major version bump.
   */
  async invokeContract(
    method: string,
    args: xdr.ScVal[]
  ): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const account = await this.server.getAccount(this.signer.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(this.txTimeoutSeconds)
      .build();

    const simulation = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new KeeperSdkError(
        `${method} simulation failed: ${simulation.error}`,
        decodeContractErrorCode(simulation.error),
        simulation
      );
    }

    const prepared = rpc.assembleTransaction(tx, simulation).build();
    prepared.sign(this.signer);

    const sendResponse = await this.server.sendTransaction(prepared);
    if (sendResponse.status === "ERROR") {
      const detail = safeStringify(sendResponse.errorResult ?? sendResponse);
      throw new KeeperSdkError(
        `${method} submission failed: ${detail}`,
        decodeContractErrorCode(detail),
        sendResponse
      );
    }

    const confirmed = await this.awaitConfirmation(sendResponse.hash);
    if (confirmed.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      // A contract error that survives simulation (state moved between
      // simulate and apply — exactly what a lost claim race looks like)
      // surfaces here instead, so the failed result is searched for a code
      // too rather than only the simulation path.
      const detail = safeStringify(confirmed);
      throw new KeeperSdkError(
        `${method} transaction ${sendResponse.hash} finished with status ${confirmed.status}`,
        decodeContractErrorCode(detail),
        confirmed
      );
    }
    return confirmed;
  }

  /**
   * Throws a `KeeperSdkError` when `address` is not this client's signer.
   *
   * A client signs as exactly one account, so a call naming a different
   * address as the party the contract will `require_auth()` can never
   * succeed. Rejecting it here costs the caller a clear message instead of
   * a simulation round trip and an opaque `Unauthorized`.
   */
  requireSignerIs(address: string, label: string): void {
    if (address !== this.signer.publicKey()) {
      throw new KeeperSdkError(
        `${label} (${address}) is not this client's signer (${this.signer.publicKey()}); ` +
          `construct a KeeperRegistryClient with that account's keypair to act as ${label}`
      );
    }
  }

  private async awaitConfirmation(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    let response = await this.server.getTransaction(hash);
    for (
      let attempt = 0;
      response.status === rpc.Api.GetTransactionStatus.NOT_FOUND && attempt < this.maxPollAttempts;
      attempt++
    ) {
      await sleep(this.pollIntervalMs);
      response = await this.server.getTransaction(hash);
    }
    return response;
  }
}

/**
 * `JSON.stringify` that degrades to the value's own string form rather than
 * throwing. RPC responses and XDR result objects carry `bigint`s, which
 * `JSON.stringify` refuses outright — and an error path that throws while
 * describing an error replaces the real failure with a `TypeError`, which is
 * the worst possible time to lose the original.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
