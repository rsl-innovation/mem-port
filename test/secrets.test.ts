import { describe, expect, it } from "vitest";
import {
  hashKeySecret,
  hashPassword,
  issueKey,
  parseKey,
  verifyKeySecret,
  verifyPassword,
} from "../src/auth/secrets.js";

describe("api keys", () => {
  it("issues a parseable key whose secret is never the stored value", () => {
    const issued = issueKey();
    const parsed = parseKey(issued.plaintext);

    expect(parsed?.keyId).toBe(issued.keyId);
    // The point of the whole scheme: what is stored cannot be replayed.
    expect(issued.plaintext).not.toContain(issued.secretHash);
    expect(issued.secretHash).toBe(hashKeySecret(parsed!.secret));
  });

  it("issues distinct keys", () => {
    const a = issueKey();
    const b = issueKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it("verifies a correct secret and rejects a wrong one", () => {
    const issued = issueKey();
    const { secret } = parseKey(issued.plaintext)!;
    expect(verifyKeySecret(secret, issued.secretHash)).toBe(true);
    expect(verifyKeySecret(secret + "x", issued.secretHash)).toBe(false);
  });

  it("rejects a hash of the wrong length instead of throwing", () => {
    // timingSafeEqual throws on length mismatch; corrupt storage must not take
    // the request down with a 500 that looks like a server fault.
    expect(verifyKeySecret("anything", "abcd")).toBe(false);
    expect(verifyKeySecret("anything", "not-hex-at-all")).toBe(false);
  });

  it.each(["", "notakey", "mp_only-two", "xx_abc_def", "mp__missingid", "mp_notthex0deadbee_secret"])(
    "refuses to parse %j",
    (bad) => {
      expect(parseKey(bad)).toBeNull();
    }
  );

  /**
   * base64url includes "_" in its alphabet, so a secret legitimately contains
   * underscores. Splitting the key on "_" rejected those, which would have
   * shown up as roughly half of all issued keys failing to authenticate.
   */
  it("parses keys whose secret contains underscores", () => {
    const withUnderscore = Array.from({ length: 200 }, () => issueKey()).filter((k) =>
      k.plaintext.slice(k.plaintext.indexOf("_", 3) + 1).includes("_")
    );
    expect(withUnderscore.length, "expected some secrets to contain underscores").toBeGreaterThan(0);

    for (const key of withUnderscore) {
      const parsed = parseKey(key.plaintext);
      expect(parsed, key.plaintext).not.toBeNull();
      expect(parsed!.keyId).toBe(key.keyId);
      expect(verifyKeySecret(parsed!.secret, key.secretHash)).toBe(true);
    }
  });
});

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects a malformed stored value rather than throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "md5$deadbeef$cafe")).toBe(false);
  });
});
