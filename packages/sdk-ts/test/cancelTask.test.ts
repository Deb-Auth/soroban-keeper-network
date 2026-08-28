import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import { KeeperError, KeeperSdkError, TaskStatus } from "../src/index";
import { FakeRegistry, clientFor } from "./support/fakeRegistry";
import { someOtherAddress, stubClient } from "./support/stubClient";

test("cancelTask cancels a Pending task", async () => {
  const registry = new FakeRegistry();
  const owner = Keypair.random();
  const taskId = registry.seedTask({ owner: owner.publicKey() });
  const { client, address } = clientFor(registry, owner);

  const result = await client.cancelTask({ owner: address, taskId });

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(registry.task(taskId).status, TaskStatus.Cancelled);
});

test("cancelTask cancels a Claimed task whose lock has lapsed", async () => {
  // The second accepted precondition, added after the contract widened
  // cancel_task beyond Pending-only. An SDK encoding the older rule would
  // wrongly refuse this.
  const registry = new FakeRegistry();
  const owner = Keypair.random();
  const taskId = registry.seedTask({ owner: owner.publicKey() });

  const keeper = clientFor(registry);
  await keeper.client.claimTask({ keeper: keeper.address, taskId });
  assert.equal(registry.task(taskId).status, TaskStatus.Claimed);
  registry.lapseLockOf(taskId);

  const { client, address } = clientFor(registry, owner);
  const result = await client.cancelTask({ owner: address, taskId });

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(registry.task(taskId).status, TaskStatus.Cancelled);
});

test("cancelTask reports LockPeriodActive for a still-locked Claimed task", async () => {
  // Retryable: the same call succeeds once the lock lapses, which the
  // following assertion confirms rather than assuming.
  const registry = new FakeRegistry();
  const owner = Keypair.random();
  const taskId = registry.seedTask({ owner: owner.publicKey() });

  const keeper = clientFor(registry);
  await keeper.client.claimTask({ keeper: keeper.address, taskId });

  const { client, address } = clientFor(registry, owner);
  assert.deepEqual(await client.cancelTask({ owner: address, taskId }), {
    status: "lock_period_active",
  });

  registry.lapseLockOf(taskId);
  assert.deepEqual(await client.cancelTask({ owner: address, taskId }), { status: "cancelled" });
});

test("cancelTask reports InvalidTaskStatus distinctly from LockPeriodActive", async () => {
  // Not retryable: a task that has already left Pending/Claimed can never be
  // cancelled, which is why this is a different outcome from a live lock.
  const registry = new FakeRegistry();
  const owner = Keypair.random();
  const { client, address } = clientFor(registry, owner);

  for (const status of [TaskStatus.Executed, TaskStatus.Cancelled, TaskStatus.Expired]) {
    const taskId = registry.seedTask({ owner: owner.publicKey(), status });
    assert.deepEqual(await client.cancelTask({ owner: address, taskId }), {
      status: "invalid_task_status",
    });
  }
});

test("cancelTask still throws when the caller is not the task's owner", async () => {
  const registry = new FakeRegistry();
  const taskId = registry.seedTask({ owner: Keypair.random().publicKey() });
  const stranger = clientFor(registry);

  await assert.rejects(
    () => stranger.client.cancelTask({ owner: stranger.address, taskId }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.NotTaskOwner
  );
});

test("cancelTask sends the owner address and task id the contract expects", async () => {
  const { client, calls, address } = stubClient();

  await client.cancelTask({ owner: address, taskId: 5 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "cancel_task");
  const args = calls[0]!.args.map((arg) => scValToNative(arg));
  assert.equal(args[0], address);
  assert.equal(args[1], 5n);
});

test("cancelTask rejects an owner that is not the client's signer", async () => {
  const { client, calls } = stubClient();

  await assert.rejects(
    () => client.cancelTask({ owner: someOtherAddress(), taskId: 5 }),
    (err: unknown) => err instanceof KeeperSdkError && /is not this client's signer/.test(err.message)
  );
  assert.equal(calls.length, 0);
});
