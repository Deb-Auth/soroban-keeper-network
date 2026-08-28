/**
 * Test harness: a `KeeperRegistryClient` whose `invokeContract` is replaced
 * with a recorder, so a method's own behaviour — its client-side validation,
 * the arguments it encodes, and how it maps a contract error onto a typed
 * result — can be asserted without a network.
 *
 * This deliberately stops at the RPC boundary. A hand-written fake RPC
 * server (issue #250) and an integration suite against a local Soroban
 * network (issue #249) cover the layers below; a unit test that reimplemented
 * either here would mostly be asserting its own fake.
 */

import { Keypair, Networks, StrKey, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { KeeperError, KeeperRegistryClient, KeeperSdkError } from "../../src/index";

/**
 * A syntactically valid contract id for a registry that is never deployed.
 * Derived rather than pasted so it cannot drift into an invalid strkey — the
 * `Contract` constructor validates it, and a bad literal fails every test
 * with a confusing error far from its cause.
 */
export const TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

/** Network passphrase every test client is built against. */
export const TEST_NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * A loopback endpoint that is never contacted: every harness here replaces
 * the one client method that would have used it.
 */
export const UNUSED_RPC_URL = "http://127.0.0.1:8000/soroban/rpc";

/** A recorded `invokeContract` call. */
export interface RecordedCall {
  method: string;
  args: xdr.ScVal[];
}

export interface StubHarness {
  client: KeeperRegistryClient;
  /** Every contract call the client attempted, in order. */
  calls: RecordedCall[];
  /** The account this client signs as. */
  address: string;
}

export interface StubOptions {
  /**
   * `ScVal` handed back as the transaction's `returnValue`, for methods
   * that decode one (`register_task` returns the new task id).
   */
  returnValue?: xdr.ScVal;
  /**
   * Contract error the stubbed invocation fails with, standing in for a
   * simulation or submission that the contract rejected.
   */
  failWith?: KeeperError;
  /** Thrown instead of a `KeeperSdkError`, to exercise non-contract failures. */
  throwInstead?: unknown;
}

/**
 * A valid-looking but unfunded account address, for the many assertions that
 * only need "some address that is not the signer".
 */
export function someOtherAddress(): string {
  return Keypair.random().publicKey();
}

/** Builds a client bound to a fresh random keypair, with `invokeContract` stubbed per `options`. */
export function stubClient(options: StubOptions = {}): StubHarness {
  const signer = Keypair.random();
  const client = new KeeperRegistryClient({
    contractId: TEST_CONTRACT_ID,
    networkPassphrase: TEST_NETWORK_PASSPHRASE,
    signer,
    rpcUrl: UNUSED_RPC_URL,
  });

  const calls: RecordedCall[] = [];
  client.invokeContract = async (method: string, args: xdr.ScVal[]) => {
    calls.push({ method, args });

    if (options.throwInstead !== undefined) {
      throw options.throwInstead;
    }
    if (options.failWith !== undefined) {
      throw new KeeperSdkError(
        `${method} simulation failed: HostError: Error(Contract, #${options.failWith})`,
        options.failWith
      );
    }
    return {
      returnValue: options.returnValue ?? nativeToScVal(null),
    } as rpc.Api.GetSuccessfulTransactionResponse;
  };

  return { client, calls, address: signer.publicKey() };
}

/** A deadline comfortably in the future, for tests that need a valid one. */
export function futureDeadline(secondsFromNow = 3600): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + secondsFromNow);
}
