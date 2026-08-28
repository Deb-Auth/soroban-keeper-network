import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import { KeeperError, KeeperSdkError, TaskStatus } from "../src/index";
import { FakeRegistry, clientFor } from "./support/fakeRegistry";
import { someOtherAddress, stubClient } from "./support/stubClient";

test("claimTask claims a Pending task and encodes every contract argument", async () => {
  const registry = new FakeRegistry();
  const taskId = registry.seedTask();
  const { client, address } = clientFor(registry);

  const result = await client.claimTask({ keeper: address, taskId });

  assert.deepEqual(result, { status: "claimed" });
  assert.equal(registry.task(taskId).status, TaskStatus.Claimed);
  assert.equal(registry.task(taskId).claimer, address);
});

test("claimTask reports LockPeriodActive as a typed outcome rather than throwing", async () => {
  // Losing a claim race is routine for a keeper bot, not exceptional: it
  // should move on to the next task and come back once the lock lapses.
  const registry = new FakeRegistry();
  const taskId = registry.seedTask();
  const firstKeeper = clientFor(registry);
  await firstKeeper.client.claimTask({ keeper: firstKeeper.address, taskId });

  const secondKeeper = clientFor(registry);
  const result = await secondKeeper.client.claimTask({ keeper: secondKeeper.address, taskId });

  assert.deepEqual(result, { status: "lock_period_active" });
  assert.equal(registry.task(taskId).claimer, firstKeeper.address);
});

test("claimTask succeeds on a re-claim once the previous keeper's lock has lapsed", async () => {
  const registry = new FakeRegistry();
  const taskId = registry.seedTask();
  const firstKeeper = clientFor(registry);
  await firstKeeper.client.claimTask({ keeper: firstKeeper.address, taskId });
  registry.lapseLockOf(taskId);

  const secondKeeper = clientFor(registry);
  const result = await secondKeeper.client.claimTask({ keeper: secondKeeper.address, taskId });

  assert.deepEqual(result, { status: "claimed" });
  assert.equal(registry.task(taskId).claimer, secondKeeper.address);
});

test("claimTask reports DeadlinePassed distinctly from LockPeriodActive", async () => {
  // The distinction is the whole point: lock_period_active means keep
  // scanning, deadline_passed means this task is dead — stop retrying it.
  const registry = new FakeRegistry();
  const taskId = registry.seedTask();
  registry.passDeadlineOf(taskId);
  const { client, address } = clientFor(registry);

  const result = await client.claimTask({ keeper: address, taskId });

  assert.deepEqual(result, { status: "deadline_passed" });
});

test("claimTask still throws for failures outside normal claim racing", async () => {
  const registry = new FakeRegistry();
  const { client, address } = clientFor(registry);

  await assert.rejects(
    () => client.claimTask({ keeper: address, taskId: 404 }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.TaskNotFound
  );
});

test("claimTask sends the keeper address and task id the contract expects", async () => {
  const { client, calls, address } = stubClient();

  await client.claimTask({ keeper: address, taskId: 9 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "claim_task");
  const args = calls[0]!.args.map((arg) => scValToNative(arg));
  assert.equal(args[0], address);
  assert.equal(args[1], 9n);
});

test("claimTask rejects a keeper that is not the client's signer", async () => {
  const { client, calls } = stubClient();

  await assert.rejects(
    () => client.claimTask({ keeper: someOtherAddress(), taskId: 9 }),
    (err: unknown) => err instanceof KeeperSdkError && /is not this client's signer/.test(err.message)
  );
  assert.equal(calls.length, 0);
});

test("claimTask is permissionless — any account may claim, not just the owner", async () => {
  const registry = new FakeRegistry();
  const owner = Keypair.random().publicKey();
  const taskId = registry.seedTask({ owner });
  const stranger = clientFor(registry);

  const result = await stranger.client.claimTask({ keeper: stranger.address, taskId });

  assert.deepEqual(result, { status: "claimed" });
  assert.notEqual(stranger.address, owner);
});
