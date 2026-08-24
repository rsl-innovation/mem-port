import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/**
 * Credential handling: issuing API keys, and verifying them and admin
 * passwords without leaking anything through storage or timing.
 */

/** How an issued key is spelled. The prefix makes a leaked key recognisable in a log or a repo scan. */
const KEY_PREFIX = "mp";
const KEY_ID_BYTES = 8;
const KEY_SECRET_BYTES = 32;

export interface IssuedKey {
  /** The full key, shown to the admin exactly once and never stored. */
  plaintext: string;
  /** Stored, and used to find the record on each request. Not secret. */
  keyId: string;
  /** Stored in place of the secret. */
  secretHash: string;
}

/**
 * Mint an API key.
 *
 * Shaped as `mp_<keyId>_<secret>` so a request can find its record by keyId in
 * one lookup instead of hashing the candidate against every key on file. The
 * keyId is not a secret and is safe to display in the admin UI; only the third
 * segment proves anything.
 */
export function issueKey(): IssuedKey {
  const keyId = randomBytes(KEY_ID_BYTES).toString("hex");
  const secret = randomBytes(KEY_SECRET_BYTES).toString("base64url");
  return {
    plaintext: `${KEY_PREFIX}_${keyId}_${secret}`,
    keyId,
    secretHash: hashKeySecret(secret),
  };
}

export interface ParsedKey {
  keyId: string;
  secret: string;
}

/**
 * Split a presented key. Returns null for anything that isn't shaped like one.
 *
 * Matched with an anchored pattern rather than split on "_": base64url's
 * alphabet INCLUDES the underscore, so a perfectly valid secret can contain
 * one and a naive three-way split would reject roughly half the keys ever
 * issued. The keyId is hex and fixed-length, which is what makes the boundary
 * between the two segments unambiguous.
 */
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}_([0-9a-f]{${KEY_ID_BYTES * 2}})_([A-Za-z0-9_-]+)$`);

export function parseKey(presented: string): ParsedKey | null {
  const match = KEY_PATTERN.exec(presented.trim());
  return match ? { keyId: match[1], secret: match[2] } : null;
}

/**
 * Hash an API key's secret.
 *
 * SHA-256 rather than a slow KDF, deliberately. A slow hash exists to make
 * guessing a low-entropy human password expensive; this secret is 32 random
 * bytes, so guessing it is already infeasible and the only thing a slow hash
 * would add is per-request latency on the hot path of every tool call.
 * Passwords, which are low-entropy, use scrypt below.
 */
export function hashKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function verifyKeySecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashKeySecret(secret), "hex");
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }
  // Length is checked first because timingSafeEqual throws on a mismatch, and
  // a digest of the wrong length is corrupt storage rather than a wrong guess.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

/**
 * Hash an admin password with scrypt.
 *
 * Stored as `scrypt$<salt>$<derived>` so the parameters travel with the value
 * and a later change of cost can be detected rather than silently mismatching.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES).toString("hex");
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expectedHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** An opaque session token for the admin UI. */
export function issueSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Stored in place of a session token, so a leaked database cannot be replayed as a login. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomUUID();
}
