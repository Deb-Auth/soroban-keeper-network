import assert from "node:assert/strict";
import { test } from "node:test";
import { scValToNative } from "@stellar/stellar-sdk";
import { KeeperError, KeeperSdkError } from "../src/index";
import { someOtherAddress, stubClient } from "./support/stubClient";

test("increaseReward tops up a task and encodes every contract argument", async () => {
  const { client, calls, address } = stubClient();

  await client.increaseReward({ owner: address, taskId: 7, additional: 5_000_000n });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "increase_reward");

  const args = calls[0]!.args.map((arg) => scValToNative(arg));
  assert.equal(args[0], address);
  assert.equal(args[1], 7n);
  assert.equal(args[2], 5_000_000n);
});

test("increaseReward rejects a non-positive amount client-side, before building a transaction", async () => {
  const { client, calls, address } = stubClient();

  for (const additional of [0n, -1n]) {
    await assert.rejects(
      () => client.increaseReward({ owner: address, taskId: 7, additional }),
      (err: unknown) => {
        assert.ok(err instanceof KeeperSdkError);
        assert.equal(err.code, KeeperError.InvalidReward);
        return true;
      }
    );
  }
  assert.equal(calls.length, 0);
});

test("increaseReward rejects an owner that is not the client's signer", async () => {
  const { client, calls } = stubClient();

  await assert.rejects(
    () => client.increaseReward({ owner: someOtherAddress(), taskId: 7, additional: 1n }),
    (err: unknown) => err instanceof KeeperSdkError && /is not this client's signer/.test(err.message)
  );
  assert.equal(calls.length, 0);
});

test("increaseReward surfaces a contract-side status rejection with its decoded code", async () => {
  // Whether a task is still Pending or Claimed is not something the client
  // knows without an extra read, so this one is only caught on-chain.
  const { client, address } = stubClient({ failWith: KeeperError.InvalidTaskStatus });

  await assert.rejects(
    () => client.increaseReward({ owner: address, taskId: 7, additional: 1n }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.InvalidTaskStatus
  );
});
