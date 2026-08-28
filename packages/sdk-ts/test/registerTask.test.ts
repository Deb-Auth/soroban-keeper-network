import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { KeeperError, KeeperSdkError, TaskType } from "../src/index";
import { futureDeadline, someOtherAddress, stubClient } from "./support/stubClient";

function validParams(owner: string) {
  return {
    owner,
    taskType: TaskType.Liquidation,
    calldata: Buffer.from("target-call"),
    reward: 10_000_000n,
    deadline: futureDeadline(),
    ttlLedgers: 20_000,
    lockLedgers: 120,
  };
}

test("registerTask returns the new task id and encodes every contract argument", async () => {
  const { client, calls, address } = stubClient({
    returnValue: nativeToScVal(42n, { type: "u64" }),
  });
  const params = validParams(address);

  const taskId = await client.registerTask(params);

  assert.equal(taskId, 42n);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "register_task");

  const args = calls[0]!.args.map((arg) => scValToNative(arg));
  assert.equal(args[0], address);
  // TaskType is a simple contracttype enum, so it goes over the wire as its
  // u32 discriminant — a mismatch here silently registers the wrong kind of
  // task, so the exact number is asserted rather than the TypeScript name.
  assert.equal(args[1], TaskType.Liquidation);
  assert.equal(args[1], 0);
  assert.deepEqual(args[2], Buffer.from("target-call"));
  assert.equal(args[3], 10_000_000n);
  assert.equal(args[4], params.deadline);
  assert.equal(args[5], 20_000);
  assert.equal(args[6], 120);
});

test("registerTask rejects a non-positive reward client-side, before building a transaction", async () => {
  const { client, calls, address } = stubClient();

  await assert.rejects(
    () => client.registerTask({ ...validParams(address), reward: 0n }),
    (err: unknown) => {
      assert.ok(err instanceof KeeperSdkError);
      assert.equal(err.code, KeeperError.InvalidReward);
      return true;
    }
  );

  // The point of the client-side check is saving the round trip, so the
  // absence of an invocation is the assertion that matters.
  assert.equal(calls.length, 0);
});

test("registerTask rejects a deadline that has already passed, client-side", async () => {
  const { client, calls, address } = stubClient();

  await assert.rejects(
    () => client.registerTask({ ...validParams(address), deadline: 1n }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.DeadlinePassed
  );
  assert.equal(calls.length, 0);
});

test("registerTask rejects out-of-range lockLedgers and ttlLedgers, client-side", async () => {
  const { client, calls, address } = stubClient();

  await assert.rejects(
    () => client.registerTask({ ...validParams(address), lockLedgers: 11 }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.InvalidTaskParams
  );
  await assert.rejects(
    () => client.registerTask({ ...validParams(address), lockLedgers: 17_281 }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.InvalidTaskParams
  );
  await assert.rejects(
    () => client.registerTask({ ...validParams(address), ttlLedgers: 999 }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.InvalidTaskParams
  );
  assert.equal(calls.length, 0);
});

test("registerTask rejects calldata over MAX_CALLDATA_LEN, client-side", async () => {
  const { client, calls, address } = stubClient();

  await assert.rejects(
    () => client.registerTask({ ...validParams(address), calldata: Buffer.alloc(1025) }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.CalldataTooLarge
  );
  assert.equal(calls.length, 0);
});

test("registerTask rejects a verifier, since the contract does not accept one yet", async () => {
  const { client, calls, address } = stubClient();

  // Silently dropping it would leave a caller believing their task is
  // verified when nothing on-chain knows about the verifier at all.
  await assert.rejects(
    () => client.registerTask({ ...validParams(address), verifier: someOtherAddress() }),
    (err: unknown) => err instanceof KeeperSdkError && /verifier is not yet supported/.test(err.message)
  );
  assert.equal(calls.length, 0);
});

test("registerTask rejects an owner that is not the client's signer", async () => {
  const { client, calls } = stubClient();

  await assert.rejects(
    () => client.registerTask(validParams(someOtherAddress())),
    (err: unknown) => err instanceof KeeperSdkError && /is not this client's signer/.test(err.message)
  );
  assert.equal(calls.length, 0);
});

test("registerTask surfaces a contract-side rejection with its decoded code", async () => {
  // MinReward is configurable per deployment, so a reward above zero can
  // still be rejected on-chain — the client check is an optimization, not a
  // replacement for the contract's own validation.
  const { client, address } = stubClient({ failWith: KeeperError.InvalidReward });

  await assert.rejects(
    () => client.registerTask({ ...validParams(address), reward: 1n }),
    (err: unknown) => err instanceof KeeperSdkError && err.code === KeeperError.InvalidReward
  );
});
