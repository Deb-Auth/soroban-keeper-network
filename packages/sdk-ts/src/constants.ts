/**
 * Protocol bounds mirrored from `contracts/keeper-registry/src/constants.rs`.
 *
 * These exist so the SDK's client-side pre-flight checks can reject an input
 * the contract would reject anyway, without a round trip. They are a copy of
 * the contract's values, not the source of truth: the contract's own
 * validation is authoritative, and a registry deployed from a newer contract
 * build could enforce different bounds than a given SDK release knows about.
 *
 * Following CONTRIBUTING.md's rule for the contract — a value enforced in
 * more than one place gets a name in exactly one place — every bound the
 * SDK checks is named here rather than inlined at its call site.
 */

/** Maximum `calldata` length, in bytes. Mirrors `MAX_CALLDATA_LEN`. */
export const MAX_CALLDATA_LEN = 1024;

/** Minimum `lock_ledgers` a task may be registered with. Mirrors `MIN_LOCK_LEDGERS` (~1 minute). */
export const MIN_LOCK_LEDGERS = 12;

/** Maximum `lock_ledgers` a task may be registered with. Mirrors `MAX_LOCK_LEDGERS` (~1 day). */
export const MAX_LOCK_LEDGERS = 17_280;

/** Minimum `ttl_ledgers` a task may be registered with. Mirrors `MIN_TTL_LEDGERS` (~83 minutes). */
export const MIN_TTL_LEDGERS = 1_000;
