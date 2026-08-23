import { describe, expect, it } from "vitest";
import { SYSTEM_DATABASE, sanitizeLibraryId } from "../src/db/libraryId.js";

describe("sanitizeLibraryId", () => {
  it("passes ordinary ids through untouched", () => {
    expect(sanitizeLibraryId("personal")).toBe("personal");
    expect(sanitizeLibraryId("acme-eng")).toBe("acme-eng");
  });

  it("normalizes case, whitespace and unsupported characters", () => {
    expect(sanitizeLibraryId("  Acme Eng!  ")).toBe("acme_eng_");
    expect(sanitizeLibraryId("9lives")).toBe("lib_9lives");
  });

  it("keeps long ids short but distinct", () => {
    const a = sanitizeLibraryId("x".repeat(80) + "-one");
    const b = sanitizeLibraryId("x".repeat(80) + "-two");
    expect(a.length).toBeLessThanOrEqual(50);
    expect(a).not.toBe(b);
  });

  /**
   * The control plane holds the credentials that decide who may reach a
   * workspace. If a library-id could name its database, a caller would be
   * handed the thing that was supposed to be gating them — so every spelling
   * that normalizes onto the reserved name has to be refused, not just the
   * literal one.
   */
  it.each([SYSTEM_DATABASE, "_MEMPORT_SYSTEM", "  _memport_system  ", "_memport system"])(
    "refuses %j, which would otherwise resolve to the control-plane database",
    (attempt) => {
      expect(() => sanitizeLibraryId(attempt)).toThrow(/reserved/i);
    }
  );

  it("still rejects an empty id", () => {
    expect(() => sanitizeLibraryId("   ")).toThrow(/must not be empty/);
  });
});
