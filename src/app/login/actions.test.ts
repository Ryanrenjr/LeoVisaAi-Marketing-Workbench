import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SITE_PASSWORD", "correct-password");
vi.stubEnv("OPERATOR_EMAIL", "operator@example.com");

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));

const maybeSingleMock = vi.fn();
const upsertMock = vi.fn().mockResolvedValue({ error: null });
const deleteEqMock = vi.fn().mockResolvedValue({ error: null });
const generateLinkMock = vi.fn();
const verifyOtpMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "login_attempts") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
        upsert: upsertMock,
        delete: () => ({ eq: deleteEqMock }),
      };
    },
    auth: { admin: { generateLink: generateLinkMock } },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp: verifyOtpMock },
  }),
}));

import { headers } from "next/headers";
import { login } from "./actions";

/** Only the rate-limiting behavior is under test here — this is the one genuinely new, security-relevant piece of logic added for the P0 fix, not a re-test of the existing generateLink/verifyOtp sign-in flow. */
describe("login rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingleMock.mockResolvedValue({ data: null });
    generateLinkMock.mockResolvedValue({
      data: { properties: { hashed_token: "token" } },
      error: null,
    });
    vi.mocked(headers).mockResolvedValue(
      new Headers({ "x-forwarded-for": "203.0.113.5" }) as unknown as Awaited<ReturnType<typeof headers>>,
    );
  });

  function formDataWith(password: string): FormData {
    const fd = new FormData();
    fd.set("password", password);
    return fd;
  }

  it("rejects a wrong password and records a failed attempt for that IP", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null });
    const state = await login({ error: null }, formDataWith("wrong"));
    expect(state.error).toBe("密码不正确。");
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "203.0.113.5", fail_count: 1, locked_until: null }),
    );
  });

  it("locks the IP out after the 5th consecutive failure", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { fail_count: 4, locked_until: null } });
    const state = await login({ error: null }, formDataWith("wrong"));
    expect(state.error).toBe("密码不正确。");
    const upsertArg = upsertMock.mock.calls[0][0];
    expect(upsertArg.fail_count).toBe(5);
    expect(upsertArg.locked_until).not.toBeNull();
  });

  it("refuses to even check the password while locked out", async () => {
    const lockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    maybeSingleMock.mockResolvedValueOnce({ data: { fail_count: 5, locked_until: lockedUntil } });
    const state = await login({ error: null }, formDataWith("correct-password"));
    expect(state.error).toMatch(/尝试次数过多/);
    // The correct password must not have been evaluated at all — generateLink (the actual sign-in step) never gets called.
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("allows login again once the lockout has expired", async () => {
    const lockedUntil = new Date(Date.now() - 60_000).toISOString(); // already in the past
    maybeSingleMock.mockResolvedValueOnce({ data: { fail_count: 5, locked_until: lockedUntil } });
    await login({ error: null }, formDataWith("correct-password"));
    expect(generateLinkMock).toHaveBeenCalled();
  });

  it("clears the attempt history for that IP on a correct password", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { fail_count: 3, locked_until: null } });
    await login({ error: null }, formDataWith("correct-password"));
    expect(deleteEqMock).toHaveBeenCalledWith("ip", "203.0.113.5");
  });

  it("falls back to a shared bucket when no IP header is present", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers() as unknown as Awaited<ReturnType<typeof headers>>);
    maybeSingleMock.mockResolvedValueOnce({ data: null });
    await login({ error: null }, formDataWith("wrong"));
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ ip: "unknown" }));
  });
});
