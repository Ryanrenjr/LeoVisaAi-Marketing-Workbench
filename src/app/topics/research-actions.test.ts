import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canApproveResearch: () => true, canRunResearch: () => true }));
vi.mock("@/lib/research-workflow", () => ({
  canApproveResearchFromStatus: () => true,
  canRunResearchFromStatus: () => true,
}));
vi.mock("@/lib/ai/providers/types", () => ({ TASK_TYPE_EMPLOYEE: { RESEARCH: "researcher", RESEARCH_AUDIT: "researcher" } }));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
const writeUsageLogMock = vi.fn().mockResolvedValue({ usageLogFailed: false });
vi.mock("@/lib/ai/usage-log", () => ({
  writeUsageLog: (...args: unknown[]) => writeUsageLogMock(...args),
  writeSearchUsageLog: vi.fn(),
}));

const getTopicByIdMock = vi.fn();
const getResearchPackByIdMock = vi.fn();
const getLatestResearchPackMock = vi.fn();
vi.mock("@/lib/topics", () => ({
  getTopicById: (...args: unknown[]) => getTopicByIdMock(...args),
  getResearchPackById: (...args: unknown[]) => getResearchPackByIdMock(...args),
  getLatestResearchPack: (...args: unknown[]) => getLatestResearchPackMock(...args),
}));

const runResearchTaskMock = vi.fn();
const runResearchOptimizationTaskMock = vi.fn();
vi.mock("@/lib/ai/router", () => ({
  runResearchTask: (...args: unknown[]) => runResearchTaskMock(...args),
  runResearchOptimizationTask: (...args: unknown[]) => runResearchOptimizationTaskMock(...args),
  isRouterResolutionFailure: (result: { provider: unknown }) => result.provider === null,
}));

/**
 * Chainable + thenable Supabase query-builder stub, keyed per table: each
 * `.from(table)` call consumes the next queued result for that table (in
 * call order), regardless of which builder methods (`eq`/`insert`/
 * `update`/`delete`/`select`/`single`) get chained on top — matches the
 * shape used by runResearch (insert().select().single() for creating rows,
 * update().eq() with no further chain for status writes).
 */
const tableResults: Record<string, { data?: unknown; error?: unknown }[]> = {};
const tableCallIndex: Record<string, number> = {};
function queue(table: string, result: { data?: unknown; error?: unknown }) {
  (tableResults[table] ??= []).push(result);
}
/** Every insert()/update() payload actually passed, in call order — lets tests assert on the real status/error text written, not just "this table got touched N times". */
let writes: { table: string; method: "insert" | "update"; payload: unknown }[] = [];
function chainable(table: string, result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    insert: (payload: unknown) => {
      writes.push({ table, method: "insert", payload });
      return builder;
    },
    update: (payload: unknown) => {
      writes.push({ table, method: "update", payload });
      return builder;
    },
    delete: () => builder,
    select: () => builder,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}
const fromMock = vi.fn((table: string) => {
  const idx = tableCallIndex[table] ?? 0;
  tableCallIndex[table] = idx + 1;
  const results = tableResults[table] ?? [];
  return chainable(table, results[idx] ?? { data: null, error: null });
});
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock, rpc: rpcMock }) }));

import { runResearch, approveResearchOnly, optimizeResearch, acceptSuggestedTopicRevision } from "./research-actions";

const RESEARCH_PACK_RESULT = {
  ok: true,
  data: {
    summary: "summary",
    keyFindings: ["finding"],
    warnings: [],
    confidence: "HIGH",
    scoreTotal: 90,
    scoreBreakdown: {},
    sources: [{ title: "Home Office", url: "https://gov.uk/x", note: "note", pageAge: "2026-01" }],
  },
  provider: "ANTHROPIC",
  modelId: "claude",
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 5,
};

const FULL_SCORE_BREAKDOWN = {
  officialSources: { score: 10, max: 20, reason: "官方来源不足" },
  factAccuracy: { score: 18, max: 20, reason: "ok" },
  policyTimeline: { score: 18, max: 20, reason: "ok" },
  scopeExceptions: { score: 12, max: 15, reason: "ok" },
  dataReliability: { score: 8, max: 10, reason: "ok" },
  externalSafety: { score: 12, max: 15, reason: "ok" },
};

const OPTIMIZED_PACK_RESULT = {
  ok: true,
  data: {
    summary: "optimized summary",
    keyFindings: ["optimized finding"],
    warnings: "",
    confidence: "HIGH",
    scoreTotal: 88,
    scoreBreakdown: FULL_SCORE_BREAKDOWN,
    sources: [{ title: "GOV.UK", url: "https://www.gov.uk/x", note: "note", pageAge: "1 month ago" }],
    suggestedTopicRevision: null,
  },
  provider: "ANTHROPIC",
  modelId: "claude",
  inputTokens: 2,
  outputTokens: 2,
  latencyMs: 8,
};

/**
 * Live audit finding (P0, round 3): a topic could reach RESEARCH_READY
 * even when research_packs or research_sources failed to save, because
 * neither insert's error was checked before advancing topics.status — the
 * evidence chain (research_packs -> research_sources) this whole product
 * depends on could silently break with no visible failure.
 */
describe("runResearch — evidence chain is fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    writes = [];
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCHING" });
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null });
    // The bootstrap research_runs row every call needs before reaching our
    // fail-closed logic.
    queue("research_runs", { data: { id: "run-1" }, error: null });
  });

  it("does not advance the topic to RESEARCH_READY when research_packs insert fails", async () => {
    queue("research_packs", { data: null, error: { message: "pack insert failed" } });

    await runResearch("topic-1");

    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(0);
    const runsUpdateCall = fromMock.mock.calls.filter(([table]) => table === "research_runs");
    expect(runsUpdateCall.length).toBeGreaterThanOrEqual(2); // initial insert + failure update
  });

  it("compensating-deletes the pack and does not advance the topic when research_sources insert fails", async () => {
    queue("research_packs", { data: { id: "pack-1" }, error: null });
    queue("research_sources", { data: null, error: { message: "sources insert failed" } });

    await runResearch("topic-1");

    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(0);
    // research_packs is touched twice: the insert, then the compensating delete.
    const packsCalls = fromMock.mock.calls.filter(([table]) => table === "research_packs");
    expect(packsCalls).toHaveLength(2);
  });

  it("advances the topic to RESEARCH_READY only once pack and sources are both confirmed saved", async () => {
    queue("research_packs", { data: { id: "pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });
    queue("topics", { data: null, error: null });

    await runResearch("topic-1");

    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(1);
    const statusEventsCalls = fromMock.mock.calls.filter(([table]) => table === "topic_status_events");
    expect(statusEventsCalls).toHaveLength(1);
  });

  it("does not insert topic_status_events when the topics status update itself fails", async () => {
    queue("research_packs", { data: { id: "pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });
    queue("topics", { data: null, error: { message: "status update failed" } });

    await runResearch("topic-1");

    const statusEventsCalls = fromMock.mock.calls.filter(([table]) => table === "topic_status_events");
    expect(statusEventsCalls).toHaveLength(0);
  });
});

/**
 * Live audit finding (P0, round 4): groundSources() (research-pack.ts) can
 * legitimately drop every claimed source — the model cited a URL the
 * search tool never actually returned — leaving resultPack.sources empty
 * even though the AI call itself succeeded (result.ok === true). The old
 * code only guarded against research_packs/research_sources insert
 * *errors*; a clean save of a pack with zero sources sailed straight
 * through to RESEARCH_READY, breaking the "every piece of content is
 * grounded in a real source" guarantee this product depends on.
 */
describe("runResearch — zero grounded sources is a hard fail, not a silent pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    writes = [];
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCHING" });
    queue("research_runs", { data: { id: "run-1" }, error: null });
  });

  it("A: fails the run and never reaches research_packs/RESEARCH_READY when grounding drops every source", async () => {
    runResearchTaskMock.mockResolvedValue({
      result: { ...RESEARCH_PACK_RESULT, data: { ...RESEARCH_PACK_RESULT.data, sources: [] } },
      searchMeta: null,
    });

    await runResearch("topic-1");

    const packsCalls = fromMock.mock.calls.filter(([table]) => table === "research_packs");
    expect(packsCalls).toHaveLength(0); // never even attempted — nothing to compensating-delete
    const sourcesCalls = fromMock.mock.calls.filter(([table]) => table === "research_sources");
    expect(sourcesCalls).toHaveLength(0);
    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(0);

    const runFailureWrite = writes.find(
      (w) => w.table === "research_runs" && w.method === "update" && (w.payload as { status?: string }).status === "failed",
    );
    expect(runFailureWrite).toBeDefined();
    expect((runFailureWrite!.payload as { error: string }).error).toMatch(/没有任何经过真实搜索验证的来源/);

    const activityWrite = writes.find(
      (w) => w.table === "topic_activity_log" && (w.payload as { activity_type?: string }).activity_type === "research_run_failed",
    );
    expect(activityWrite).toBeDefined();
    expect((activityWrite!.payload as { detail: { error: string } }).detail.error).toMatch(/没有任何经过真实搜索验证的来源/);
  });

  it("B: a single grounded source is enough to save normally and proceed toward RESEARCH_READY", async () => {
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null }); // 1 source, from the shared fixture
    queue("research_packs", { data: { id: "pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });
    queue("topics", { data: null, error: null });

    await runResearch("topic-1");

    const packsCalls = fromMock.mock.calls.filter(([table]) => table === "research_packs");
    expect(packsCalls).toHaveLength(1);
    const sourcesCalls = fromMock.mock.calls.filter(([table]) => table === "research_sources");
    expect(sourcesCalls).toHaveLength(1);
    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(1);
  });

  it("C: a DB error inserting research_sources (1+ sources, not a zero-source pack) still fails closed as before", async () => {
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null });
    queue("research_packs", { data: { id: "pack-1" }, error: null });
    queue("research_sources", { data: null, error: { message: "sources insert failed" } });

    await runResearch("topic-1");

    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(0);
    const packsCalls = fromMock.mock.calls.filter(([table]) => table === "research_packs");
    expect(packsCalls).toHaveLength(2); // insert + compensating delete
  });
});

/**
 * Live audit finding (P0, round 7): approveResearchOnly() used to insert
 * research_approvals, then update topics.status WITHOUT checking the error
 * or affected-row count, then unconditionally insert a topic_status_events
 * row and return true — a concurrent status change (or a transient error
 * on just that one statement) could leave a fake "approved" status event
 * on record while the topic's real status never moved. Delegated to the
 * approve_research() Postgres function (0029_approve_research_rpc.sql),
 * which does the whole sequence as one transaction; this function now only
 * returns true once that RPC call has actually succeeded. True atomicity
 * (the DB-level rollback-on-failure guarantee) can't be proven by a mocked
 * unit test — see the live verification script used for that separately.
 */
describe("approveResearchOnly — delegates atomically to the approve_research RPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_READY" });
    // A pack scoring comfortably above the 80-point threshold — these tests
    // are about the RPC-delegation behavior, not the score gate itself
    // (see the dedicated "score gate" describe block below).
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "topic-1", score_total: 95 });
    // Same pack is also "the latest" — these tests aren't about the
    // stale-pack-id gate either (see the dedicated describe block for that).
    getLatestResearchPackMock.mockResolvedValue({ id: "pack-1" });
  });

  it("returns false, and never logs a success activity, when the RPC call fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "topic is not RESEARCH_READY" } });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(false);
    const activityCalls = fromMock.mock.calls.filter(([table]) => table === "topic_activity_log");
    expect(activityCalls).toHaveLength(0);
  });

  it("returns true and calls the RPC with the right parameters when it succeeds", async () => {
    rpcMock.mockResolvedValue({ data: [{ topic_id: "topic-1" }], error: null });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("approve_research", {
      p_topic_id: "topic-1",
      p_research_pack_id: "pack-1",
      p_decided_by: "operator-1",
    });
  });
});

/**
 * Live audit finding: B｜政策研究员's own Skill has always defined 90-100 =
 * APPROVED, 80-89 = APPROVED WITH CAUTION, 70-79 = RESEARCH MORE, <70 =
 * REJECT — but nothing server-side ever actually checked score_total
 * before approving. A 46/100 pack could be (and was) approved exactly the
 * same as a 95/100 one. This is the JS-level half of the fix (fails fast,
 * without a round trip); the DB-level half
 * (0036_research_optimization_and_score_gate.sql's approve_research())
 * is what actually can't be bypassed by a direct RPC call — both read the
 * same real score, so they can't drift apart from each other.
 */
describe("approveResearchOnly — score gate (research-pack.ts's canApproveResearchScore)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_READY" });
    rpcMock.mockResolvedValue({ data: [{ topic_id: "topic-1" }], error: null });
    // These tests are about the score gate, not the stale-pack-id gate —
    // every test here uses "pack-1" as both the submitted and the latest id.
    getLatestResearchPackMock.mockResolvedValue({ id: "pack-1" });
  });

  it("46/100: refuses to approve, and never even calls the RPC", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "topic-1", score_total: 46 });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("75/100 (RESEARCH MORE band): refuses to approve", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "topic-1", score_total: 75 });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("82/100 (APPROVED WITH CAUTION band): allows approval", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "topic-1", score_total: 82 });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(true);
    expect(rpcMock).toHaveBeenCalled();
  });

  it("95/100 (APPROVED band): allows approval", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "topic-1", score_total: 95 });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(true);
    expect(rpcMock).toHaveBeenCalled();
  });

  it("refuses to approve when the pack belongs to a different topic (defensive check, mirrors the RPC's own)", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "some-other-topic", score_total: 95 });

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses to approve when the research pack can't be found at all", async () => {
    getResearchPackByIdMock.mockResolvedValue(null);

    const approved = await approveResearchOnly("topic-1", "pack-1");

    expect(approved).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

/**
 * Live audit finding: a topic can accumulate several research_packs rows
 * over time (initial + N optimization passes). A stale browser tab that
 * loaded the review page before a later optimization pass ran still holds
 * the OLD pack's id in its "通过，开始生成" form — submitting it must never
 * approve that superseded pack, even if its score was high enough on its
 * own, and even if the CURRENT latest pack also happens to score high
 * enough. Only the actual current latest pack may ever be approved.
 */
describe("approveResearchOnly — only the topic's current latest pack can be approved (stale browser tab / old pack id)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_READY" });
    rpcMock.mockResolvedValue({ data: [{ topic_id: "topic-1" }], error: null });
  });

  it("refuses a stale pack id even though it scores 85 and the topic is otherwise approvable, because a newer pack now exists", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "old-pack", topic_id: "topic-1", score_total: 85 });
    getLatestResearchPackMock.mockResolvedValue({ id: "new-pack" }); // a later optimization pass superseded it

    const approved = await approveResearchOnly("topic-1", "old-pack");

    expect(approved).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses the old pack even when the newer pack scored LOWER (85 -> 72) - score alone never overrides recency", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "old-pack", topic_id: "topic-1", score_total: 85 });
    getLatestResearchPackMock.mockResolvedValue({ id: "new-pack" }); // the newer pack (72/100) is what must be reviewed instead

    const approved = await approveResearchOnly("topic-1", "old-pack");

    expect(approved).toBe(false);
  });

  it("approves normally when the submitted pack id IS the current latest one", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "new-pack", topic_id: "topic-1", score_total: 85 });
    getLatestResearchPackMock.mockResolvedValue({ id: "new-pack" });

    const approved = await approveResearchOnly("topic-1", "new-pack");

    expect(approved).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("approve_research", {
      p_topic_id: "topic-1",
      p_research_pack_id: "new-pack",
      p_decided_by: "operator-1",
    });
  });

  it("refuses when there is somehow no latest pack on record at all (defensive - should never happen once a pack exists)", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "old-pack", topic_id: "topic-1", score_total: 85 });
    getLatestResearchPackMock.mockResolvedValue(null);

    const approved = await approveResearchOnly("topic-1", "old-pack");

    expect(approved).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

/**
 * B｜政策研究员's "研究优化" mode — a targeted follow-up pass over the
 * CURRENT latest pack (docs/ai-workflows.md "研究优化"). Never touches
 * topics.status (same-stage refinement, not a pipeline transition) and
 * never deletes the previous pack on success or failure — history is kept
 * automatically by getLatestResearchPack always returning the newest row.
 */
describe("optimizeResearch — targeted second-stage research over the current pack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    writes = [];
    getTopicByIdMock.mockResolvedValue({
      id: "topic-1",
      status: "RESEARCH_READY",
      title: "t",
      question: "q",
      business: "b",
      audience: "a",
    });
    getLatestResearchPackMock.mockResolvedValue({
      id: "prev-pack-1",
      topic_id: "topic-1",
      summary: "old summary",
      key_findings: ["old finding"],
      warnings: "",
      confidence: "LOW",
      score_total: 46,
      score_breakdown: FULL_SCORE_BREAKDOWN,
    });
    queue("research_runs", { data: { id: "run-2" }, error: null });
  });

  it("creates a brand-new research_packs row without ever touching/deleting the previous one", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({ result: OPTIMIZED_PACK_RESULT, searchMeta: null, auditUsage: null });
    queue("research_packs", { data: { id: "new-pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });

    const result = await optimizeResearch("topic-1");

    expect(result).toEqual({ ok: true });
    const packWrites = writes.filter((w) => w.table === "research_packs");
    expect(packWrites).toHaveLength(1);
    expect(packWrites[0].method).toBe("insert");
  });

  /**
   * Live audit finding: the independent audit is a genuinely separate
   * model call (see research-optimization.ts / router.ts) — it must be
   * logged as its own ai_usage_log row under RESEARCH_AUDIT, distinct from
   * the content call's own row under RESEARCH, so real spend on the two is
   * traceable separately.
   */
  it("logs the independent audit call as its own ai_usage_log row, separate from the content call", async () => {
    writeUsageLogMock.mockClear();
    runResearchOptimizationTaskMock.mockResolvedValue({
      result: OPTIMIZED_PACK_RESULT,
      searchMeta: null,
      auditUsage: {
        provider: "ANTHROPIC",
        modelId: "claude-sonnet-5",
        inputTokens: 5,
        outputTokens: 5,
        latencyMs: 20,
        ok: true,
        error: null,
      },
    });
    queue("research_packs", { data: { id: "new-pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });

    await optimizeResearch("topic-1");

    const auditLogCall = writeUsageLogMock.mock.calls.find(([, input]) => input.task_type === "RESEARCH_AUDIT");
    expect(auditLogCall).toBeDefined();
    expect(auditLogCall![1]).toMatchObject({
      model_alias: "ANTHROPIC/claude-sonnet-5",
      provider: "ANTHROPIC",
      success: true,
    });
    // The content call's own row is still written too — two rows, not one.
    const contentLogCall = writeUsageLogMock.mock.calls.find(([, input]) => input.task_type === "RESEARCH");
    expect(contentLogCall).toBeDefined();
  });

  it("never touches topics.status, even when the new score clears 80", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({ result: OPTIMIZED_PACK_RESULT, searchMeta: null });
    queue("research_packs", { data: { id: "new-pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });

    await optimizeResearch("topic-1");

    const topicsCalls = fromMock.mock.calls.filter(([table]) => table === "topics");
    expect(topicsCalls).toHaveLength(0);
  });

  it("never calls the approve_research RPC itself — approval stays a separate, explicit human click", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({ result: OPTIMIZED_PACK_RESULT, searchMeta: null });
    queue("research_packs", { data: { id: "new-pack-1" }, error: null });
    queue("research_sources", { data: null, error: null });

    await optimizeResearch("topic-1");

    expect(rpcMock).not.toHaveBeenCalled();
  });

  /**
   * Live audit finding: the raw router/search error used to be returned
   * to the caller verbatim — an internal detail like "当前未配置搜索服务
   * 提供商" leaking straight to a normal operator's screen. It must now
   * show a generic, plain-language message; the real technical detail is
   * still recorded in full server-side (research_runs.error and the
   * research_optimization_failed activity log entry) for an admin to find.
   */
  it("on a router/search resolution failure tagged SEARCH_UNAVAILABLE, shows the search-specific message but keeps the real detail in the admin-facing log", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({
      result: {
        ok: false,
        data: null,
        error: "优化研究需要联网搜索能力，当前未配置搜索服务提供商，无法针对性补充证据。",
        provider: null,
        modelId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 5,
      },
      searchMeta: null,
      failureReason: "SEARCH_UNAVAILABLE",
    });

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("暂时无法继续研究。当前搜索服务不可用，请稍后重试。");
    expect(result.error).not.toMatch(/搜索服务提供商|provider|router/i);
    const packWrites = writes.filter((w) => w.table === "research_packs");
    expect(packWrites).toHaveLength(0);

    // The real, technical detail is still recorded — server/admin log, not lost.
    const runFailureWrite = writes.find((w) => w.table === "research_runs" && w.method === "insert");
    expect((runFailureWrite!.payload as { error: string }).error).toMatch(/未配置搜索服务提供商/);
    const activityWrite = writes.find(
      (w) => w.table === "topic_activity_log" && (w.payload as { activity_type?: string }).activity_type === "research_optimization_failed",
    );
    expect((activityWrite!.payload as { detail: { error: string } }).detail.error).toMatch(/未配置搜索服务提供商/);
  });

  /**
   * Live audit finding: a resolution failure tagged AI_FAILURE (e.g. the
   * independent audit call couldn't resolve a model) used to ALSO get
   * relabeled as "search unavailable", which is simply wrong — it has
   * nothing to do with search — and tells the operator to wait for the
   * wrong thing to come back.
   */
  it("on a router resolution failure tagged AI_FAILURE, shows the generic failure message instead of blaming search", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({
      result: {
        ok: false,
        data: null,
        error: "研究内容已生成，但无法进行独立复核评分：尚未为该任务配置默认模型。",
        provider: null,
        modelId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 5,
      },
      searchMeta: null,
      failureReason: "AI_FAILURE",
    });

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("本次研究优化未能完成，请重试。原研究结果已保留。");
    expect(result.error).not.toMatch(/搜索|复核评分|模型/);

    const runFailureWrite = writes.find((w) => w.table === "research_runs" && w.method === "insert");
    expect((runFailureWrite!.payload as { error: string }).error).toMatch(/独立复核评分/);
  });

  /**
   * A successful CONTENT/AUDIT resolution that then fails at generation
   * time (schema-invalid output, provider error) is a different failure
   * shape (result.ok/result.data present in the union but false/null,
   * never hits isRouterResolutionFailure) — must be sanitized the same way.
   */
  it("on a content/audit generation failure (not a resolution failure), shows the generic message, never the raw provider error", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({
      result: {
        ok: false,
        data: null,
        error: "Anthropic API 错误 (429): rate limited",
        provider: "ANTHROPIC",
        modelId: "claude-sonnet-5",
        inputTokens: 10,
        outputTokens: 0,
        latencyMs: 100,
      },
      searchMeta: null,
      auditUsage: null,
    });

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("本次研究优化未能完成，请重试。原研究结果已保留。");
    expect(result.error).not.toMatch(/Anthropic|429|rate limited/i);
  });

  it("on a research_packs save failure, shows the generic message, never the raw SQL error", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({ result: OPTIMIZED_PACK_RESULT, searchMeta: null, auditUsage: null });
    queue("research_packs", { data: null, error: { message: 'duplicate key value violates unique constraint "x"' } });

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("本次研究优化未能完成，请重试。原研究结果已保留。");
    expect(result.error).not.toMatch(/duplicate key|constraint|sql/i);
  });

  it("on a research_sources save failure, shows the generic message, never the raw SQL error", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({ result: OPTIMIZED_PACK_RESULT, searchMeta: null, auditUsage: null });
    queue("research_packs", { data: { id: "new-pack-1" }, error: null });
    queue("research_sources", { data: null, error: { message: "insert or update violates foreign key constraint" } });

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("本次研究优化未能完成，请重试。原研究结果已保留。");
    expect(result.error).not.toMatch(/foreign key|constraint|sql/i);
  });

  it("on a zero-grounded-sources result, fails closed instead of saving an unevidenced pack", async () => {
    runResearchOptimizationTaskMock.mockResolvedValue({
      result: { ...OPTIMIZED_PACK_RESULT, data: { ...OPTIMIZED_PACK_RESULT.data, sources: [] } },
      searchMeta: null,
    });

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    const packWrites = writes.filter((w) => w.table === "research_packs");
    expect(packWrites).toHaveLength(0);
  });

  it("refuses to optimize a topic that doesn't exist", async () => {
    getTopicByIdMock.mockResolvedValue(null);

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(runResearchOptimizationTaskMock).not.toHaveBeenCalled();
  });

  it("refuses to optimize when there is no research pack yet (or it has no real score data)", async () => {
    getLatestResearchPackMock.mockResolvedValue(null);

    const result = await optimizeResearch("topic-1");

    expect(result.ok).toBe(false);
    expect(runResearchOptimizationTaskMock).not.toHaveBeenCalled();
  });
});

/**
 * The human decision point for B's suggested_topic_revision (RESULT 2 of
 * 研究优化 — the evidence is fine, but the topic itself overstates it).
 * Reuses runResearch wholesale for the re-research step rather than a
 * second, parallel research-running code path.
 */
describe("acceptSuggestedTopicRevision — human decision point for B's suggested topic change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    writes = [];
    getTopicByIdMock.mockResolvedValue({ id: "topic-1", status: "RESEARCH_READY", title: "旧标题", question: "旧问题" });
  });

  it("updates the topic's title/question, logs the decision with before/after, and triggers a fresh (optimization-tagged) research run", async () => {
    getResearchPackByIdMock.mockResolvedValue({
      id: "pack-1",
      topic_id: "topic-1",
      suggested_topic_revision: { title: "新标题", question: "新问题", reason: "原标题过于绝对" },
    });
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null });
    queue("topics", { data: null, error: null });
    queue("research_runs", { data: { id: "run-3" }, error: null });
    queue("research_packs", { data: { id: "pack-2" }, error: null });
    queue("research_sources", { data: null, error: null });

    const result = await acceptSuggestedTopicRevision("topic-1", "pack-1");

    expect(result).toEqual({ ok: true });

    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect(topicUpdate?.payload).toEqual({ title: "新标题", question: "新问题", status: "RESEARCHING" });

    // Live audit finding: the topic must move back to RESEARCHING (and
    // this recorded as a real status event) as part of THIS SAME update,
    // before runResearch ever runs — otherwise the topic would sit at
    // RESEARCH_READY with a stale pack still approvable during the whole
    // re-research window.
    const statusEvent = writes.find((w) => w.table === "topic_status_events" && w.method === "insert");
    expect(statusEvent?.payload).toMatchObject({ topic_id: "topic-1", from_status: "RESEARCH_READY", to_status: "RESEARCHING" });

    const revisionActivity = writes.find(
      (w) => w.table === "topic_activity_log" && (w.payload as { activity_type?: string }).activity_type === "research_topic_revision_accepted",
    );
    expect(revisionActivity).toBeDefined();
    expect((revisionActivity!.payload as { detail: Record<string, unknown> }).detail).toMatchObject({
      previousTitle: "旧标题",
      newTitle: "新标题",
      previousQuestion: "旧问题",
      newQuestion: "新问题",
      reason: "原标题过于绝对",
    });

    // runResearch actually ran, tagged as part of the optimization thread.
    const runInsert = writes.find(
      (w) => w.table === "research_runs" && w.method === "insert" && (w.payload as { status?: string }).status === "running",
    );
    expect(runInsert).toBeDefined();
    expect((runInsert!.payload as { run_type?: string }).run_type).toBe("optimization");
  });

  it("also updates audience, and logs before/after, when B's suggestion included one", async () => {
    getTopicByIdMock.mockResolvedValue({
      id: "topic-1",
      status: "RESEARCH_READY",
      title: "旧标题",
      question: "旧问题",
      audience: "所有工签持有人",
    });
    getResearchPackByIdMock.mockResolvedValue({
      id: "pack-1",
      topic_id: "topic-1",
      suggested_topic_revision: {
        title: "新标题",
        question: "新问题",
        audience: "已在英国工签路径上、尚未拿到永居的人",
        reason: "原标题暗示适用于所有工签持有人，实际上只适用于已经在路径上的人",
      },
    });
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null });
    queue("topics", { data: null, error: null });
    queue("research_runs", { data: { id: "run-3" }, error: null });
    queue("research_packs", { data: { id: "pack-2" }, error: null });
    queue("research_sources", { data: null, error: null });

    const result = await acceptSuggestedTopicRevision("topic-1", "pack-1");

    expect(result).toEqual({ ok: true });
    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect(topicUpdate?.payload).toEqual({
      title: "新标题",
      question: "新问题",
      audience: "已在英国工签路径上、尚未拿到永居的人",
      status: "RESEARCHING",
    });

    const revisionActivity = writes.find(
      (w) => w.table === "topic_activity_log" && (w.payload as { activity_type?: string }).activity_type === "research_topic_revision_accepted",
    );
    expect((revisionActivity!.payload as { detail: Record<string, unknown> }).detail).toMatchObject({
      previousAudience: "所有工签持有人",
      newAudience: "已在英国工签路径上、尚未拿到永居的人",
    });
  });

  it("leaves audience untouched (not in the update payload at all) when B's suggestion didn't include one", async () => {
    getResearchPackByIdMock.mockResolvedValue({
      id: "pack-1",
      topic_id: "topic-1",
      suggested_topic_revision: { title: "新标题", question: "新问题", audience: null, reason: "r" },
    });
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null });
    queue("topics", { data: null, error: null });
    queue("research_runs", { data: { id: "run-3" }, error: null });
    queue("research_packs", { data: { id: "pack-2" }, error: null });
    queue("research_sources", { data: null, error: null });

    await acceptSuggestedTopicRevision("topic-1", "pack-1");

    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect(topicUpdate?.payload).toEqual({ title: "新标题", question: "新问题", status: "RESEARCHING" });
    expect(topicUpdate?.payload).not.toHaveProperty("audience");

    const revisionActivity = writes.find(
      (w) => w.table === "topic_activity_log" && (w.payload as { activity_type?: string }).activity_type === "research_topic_revision_accepted",
    );
    expect((revisionActivity!.payload as { detail: Record<string, unknown> }).detail).not.toHaveProperty("previousAudience");
    expect((revisionActivity!.payload as { detail: Record<string, unknown> }).detail).not.toHaveProperty("newAudience");
  });

  /**
   * The exact scenario from the audit request: an 85-scoring pack exists,
   * the topic gets edited (title/question here, via the AI-suggested-
   * revision path), and the ensuing re-research fails. The topic must end
   * up sitting at RESEARCHING (never silently back at RESEARCH_READY), the
   * OLD pack must still exist untouched (nothing here ever deletes it),
   * and — critically — that old pack must no longer be approvable, which
   * falls straight out of the existing RESEARCH_READY-only gate
   * (canApproveResearchFromStatus / approve_research) now that the status
   * genuinely reflects RESEARCHING instead of the stale RESEARCH_READY.
   */
  /**
   * The full round trip: RESEARCH_READY -> (accept revision) ->
   * RESEARCHING -> (re-research succeeds) -> RESEARCH_READY. Uses
   * mockResolvedValueOnce twice on getTopicById to reflect the real
   * sequence — acceptSuggestedTopicRevision's own fetch sees the topic
   * still at RESEARCH_READY (before it writes anything), then runResearch's
   * OWN internal fetch (a completely separate DB read in the real app)
   * sees the RESEARCHING status this function just wrote — proving
   * runResearch's existing fromStatus/toStatus logic genuinely advances
   * the topic back to RESEARCH_READY only once new evidence is actually
   * saved, using the real sequencing rather than one static mock value.
   */
  it("on re-research success: the topic advances all the way back to RESEARCH_READY, and the new pack is what's latest", async () => {
    getTopicByIdMock.mockReset();
    getTopicByIdMock.mockResolvedValueOnce({ id: "topic-1", status: "RESEARCH_READY", title: "旧标题", question: "旧问题" });
    getTopicByIdMock.mockResolvedValueOnce({ id: "topic-1", status: "RESEARCHING" });
    getResearchPackByIdMock.mockResolvedValue({
      id: "pack-1",
      topic_id: "topic-1",
      suggested_topic_revision: { title: "新标题", question: "新问题", reason: "原标题过于绝对" },
    });
    runResearchTaskMock.mockResolvedValue({ result: RESEARCH_PACK_RESULT, searchMeta: null });
    queue("topics", { data: null, error: null }); // acceptSuggestedTopicRevision's own update -> RESEARCHING
    queue("research_runs", { data: { id: "run-3" }, error: null });
    queue("research_packs", { data: { id: "pack-2" }, error: null });
    queue("research_sources", { data: null, error: null });
    queue("topics", { data: null, error: null }); // runResearch's own advance -> RESEARCH_READY

    const result = await acceptSuggestedTopicRevision("topic-1", "pack-1");

    expect(result).toEqual({ ok: true });

    const topicWrites = writes.filter((w) => w.table === "topics" && w.method === "update");
    expect(topicWrites).toHaveLength(2);
    expect((topicWrites[0].payload as Record<string, unknown>).status).toBe("RESEARCHING");
    expect((topicWrites[1].payload as Record<string, unknown>).status).toBe("RESEARCH_READY");

    const statusEvents = writes.filter((w) => w.table === "topic_status_events");
    expect(statusEvents.map((w) => w.payload)).toEqual([
      expect.objectContaining({ from_status: "RESEARCH_READY", to_status: "RESEARCHING" }),
      expect.objectContaining({ from_status: "RESEARCHING", to_status: "RESEARCH_READY" }),
    ]);

    // The new pack is what was actually inserted — the "latest" one going
    // forward (getLatestResearchPack always reads back whichever pack is
    // newest, so no separate "make this the latest" step is needed).
    const packInsert = writes.find((w) => w.table === "research_packs" && w.method === "insert");
    expect(packInsert).toBeDefined();
  });

  it("on re-research failure: topic stays at RESEARCHING (not silently reverted to RESEARCH_READY), and the old pack is never touched", async () => {
    getResearchPackByIdMock.mockResolvedValue({
      id: "pack-1",
      topic_id: "topic-1",
      score_total: 85,
      suggested_topic_revision: { title: "新标题", question: "新问题", reason: "原标题过于绝对" },
    });
    runResearchTaskMock.mockResolvedValue({
      result: {
        ok: false,
        data: null,
        error: "所选模型不存在或已停用。",
        provider: null,
        modelId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 5,
      },
      searchMeta: null,
    });
    queue("topics", { data: null, error: null }); // acceptSuggestedTopicRevision's own title/question/status update

    const result = await acceptSuggestedTopicRevision("topic-1", "pack-1");

    // acceptSuggestedTopicRevision itself still reports ok:true — it did
    // its own job (updated the topic, moved it to RESEARCHING); whether
    // the subsequent re-research succeeds is reported through the normal
    // research-run failure/activity-log path, same as any other
    // "重新运行研究" click that happens to fail.
    expect(result).toEqual({ ok: true });

    // Exactly one topics write — the RESEARCHING one — ever happens.
    // runResearch's own failure branch never touches topics.status at all.
    const topicWrites = writes.filter((w) => w.table === "topics");
    expect(topicWrites).toHaveLength(1);
    expect((topicWrites[0].payload as Record<string, unknown>).status).toBe("RESEARCHING");

    // The old research_packs row is never deleted or overwritten — nothing
    // in this whole call path issues a research_packs write once
    // runResearchTask itself fails this early.
    expect(writes.filter((w) => w.table === "research_packs")).toHaveLength(0);

    const runFailure = writes.find(
      (w) => w.table === "research_runs" && w.method === "insert" && (w.payload as { status?: string }).status === "failed",
    );
    expect(runFailure).toBeDefined();
  });

  it("refuses, and touches nothing, when the pack has no suggested_topic_revision to adopt", async () => {
    getResearchPackByIdMock.mockResolvedValue({ id: "pack-1", topic_id: "topic-1", suggested_topic_revision: null });

    const result = await acceptSuggestedTopicRevision("topic-1", "pack-1");

    expect(result.ok).toBe(false);
    expect(writes.filter((w) => w.table === "topics")).toHaveLength(0);
    expect(runResearchTaskMock).not.toHaveBeenCalled();
  });

  it("refuses when the pack belongs to a different topic", async () => {
    getResearchPackByIdMock.mockResolvedValue({
      id: "pack-1",
      topic_id: "some-other-topic",
      suggested_topic_revision: { title: "新标题", question: "新问题", reason: "r" },
    });

    const result = await acceptSuggestedTopicRevision("topic-1", "pack-1");

    expect(result.ok).toBe(false);
    expect(writes.filter((w) => w.table === "topics")).toHaveLength(0);
  });
});
