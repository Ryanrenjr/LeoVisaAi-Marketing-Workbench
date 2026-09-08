import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SITE_PASSWORD", "correct-password");
vi.stubEnv("OPERATOR_EMAIL", "operator@example.com");

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));

const rpcMock = vi.fn();
const generateLinkMock = vi.fn();
const verifyOtpMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: rpcMock,
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

/**
 * Live audit finding (P0, round 8): rate limiting used to be
 * "SELECT fail_count -> JS +1 -> UPSERT", a lost-update race for
 * concurrent wrong-password requests, and none of its three DB calls
 * checked their own error — a transient failure silently looked like "no
 * failure record" and let the attempt through. Delegated to the atomic
 * record_login_attempt() RPC (0031_login_rate_limit_rpc.sql); these tests
 * cover the TS-level orchestration around it — real concurrent-request
 * atomicity is verified live against the actual Postgres function
 * separately, not provable by a mocked unit test.
 */
describe("login rate limiting — delegates atomically to record_login_attempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("rejects a wrong password, passing p_success:false to the RPC", async () => {
    rpcMock.mockResolvedValue({ data: [{ locked: false, locked_until: null, fail_count: 1 }], error: null });

    const state = await login({ error: null }, formDataWith("wrong"));

    expect(state.error).toBe("密码不正确。");
    expect(rpcMock).toHaveBeenCalledWith("record_login_attempt", {
      p_ip: "203.0.113.5",
      p_success: false,
      p_max_attempts: 5,
      p_lockout_seconds: 900,
    });
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("shows the lockout message (and never evaluates generateLink) when the RPC reports locked, even with the correct password", async () => {
    const lockedUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    rpcMock.mockResolvedValue({ data: [{ locked: true, locked_until: lockedUntil, fail_count: 5 }], error: null });

    const state = await login({ error: null }, formDataWith("correct-password"));

    expect(state.error).toMatch(/尝试次数过多/);
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("fails closed — refuses login without ever calling generateLink — when the RPC call itself errors, even with the correct password", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const state = await login({ error: null }, formDataWith("correct-password"));

    expect(state.error).toMatch(/服务暂时不可用/);
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("proceeds to generateLink/verifyOtp on a correct password when not locked", async () => {
    rpcMock.mockResolvedValue({ data: [{ locked: false, locked_until: null, fail_count: 0 }], error: null });

    await login({ error: null }, formDataWith("correct-password"));

    expect(rpcMock).toHaveBeenCalledWith("record_login_attempt", expect.objectContaining({ p_success: true }));
    expect(generateLinkMock).toHaveBeenCalled();
    expect(verifyOtpMock).toHaveBeenCalled();
  });

  it("falls back to a shared bucket when no IP header is present", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers() as unknown as Awaited<ReturnType<typeof headers>>);
    rpcMock.mockResolvedValue({ data: [{ locked: false, locked_until: null, fail_count: 1 }], error: null });

    await login({ error: null }, formDataWith("wrong"));

    expect(rpcMock).toHaveBeenCalledWith("record_login_attempt", expect.objectContaining({ p_ip: "unknown" }));
  });
});
