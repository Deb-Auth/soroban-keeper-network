import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import { KeeperError, KeeperSdkError, TaskStatus } from "../src/index";
import { FakeRegistry, clientFor } from "./support/fakeRegistry";
import { someOtherAddress, stubClient } from "./support/stubClient";

test("expireTask lets an account unrelated to the task expire it past its deadline", async () => {
  // The defining property of this method: no owner, keeper, or claimer
  // relationship is required. The caller below is none of the three.
  const registry = new FakeRegistry();
  const owner = Keypair.random().publicKey();
  const taskId = registry.seedTask({ owner });

  const keeper = clientFor(registry);
  await keeper.client.claimTask({ keeper: keeper.address, taskId });
  registry.passDeadlineOf(taskId);

  const stranger = clientFor(registry);
  assert.notEqual(stranger.address, owner);
  assert.notEqual(stranger.address, registry.task(taskId).claimer);

  await stranger.client.expireTask({ taskId, caller: stranger.address });

  assert.equal(registry.task(taskId).status, TaskStatus.Expired);
});

test("expireTask expires a Pending task that nobody ever claimed", async () => {
  const registry = new FakeRegistry();
  const taskId = registry.seedTask();
  registry.passDeadlineOf(taskId);
  const stranger = clientFor(registry);

  await stranger.client.expireTask({ taskId, caller: stranger.address });

  assert.equal(registry.task(taskId).status, TaskStatus.Expired);
});

test("expireTask rejects a task whose deadline has not passed", async () => {
  const registry = new FakeRegistry();
  const taskId = registry.seedTask();
  const stranger = clientFor(registry);

  await assert.rejects(
    () => stranger.client.expireTask({ taskId, caller: stranger.address }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.DeadlineNotPassed
  );
  assert.equal(registry.task(taskId).status, TaskStatus.Pending);
});

test("expireTask passes only the task id — the contract takes no caller argument", async () => {
  // `caller` is the transaction source account and nothing more; it must not
  // leak into the invocation, or the call would not match the contract's ABI.
  const { client, calls, address } = stubClient();

  await client.expireTask({ taskId: 3, caller: address });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "expire_task");
  assert.equal(calls[0]!.args.length, 1);
  assert.equal(scValToNative(calls[0]!.args[0]!), 3n);
});

test("expireTask rejects a caller that is not the client's signer", async () => {
  // Not an authorization rule of the contract's — a client signs as exactly
  // one account, so naming a different source account here is a mistake.
  const { client, calls } = stubClient();

  await assert.rejects(
    () => client.expireTask({ taskId: 3, caller: someOtherAddress() }),
    (err: unknown) => err instanceof KeeperSdkError && /is not this client's signer/.test(err.message)
  );
  assert.equal(calls.length, 0);
});
