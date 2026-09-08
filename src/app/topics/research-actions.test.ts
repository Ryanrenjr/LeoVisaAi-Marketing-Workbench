import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));
vi.mock("@/lib/permissions", () => ({ canApproveResearch: () => true, canRunResearch: () => true }));
vi.mock("@/lib/research-workflow", () => ({
  canApproveResearchFromStatus: () => true,
  canRunResearchFromStatus: () => true,
}));
vi.mock("@/lib/ai/providers/types", () => ({ TASK_TYPE_EMPLOYEE: { RESEARCH: "researcher" } }));
vi.mock("@/lib/ai/providers/registry", () => ({ getModel: () => ({ pricingType: "FREE" }) }));
vi.mock("@/lib/ai/usage-log", () => ({
  writeUsageLog: vi.fn().mockResolvedValue({ usageLogFailed: false }),
  writeSearchUsageLog: vi.fn(),
}));

const getTopicByIdMock = vi.fn();
vi.mock("@/lib/topics", () => ({ getTopicById: (...args: unknown[]) => getTopicByIdMock(...args) }));

const runResearchTaskMock = vi.fn();
vi.mock("@/lib/ai/router", () => ({
  runResearchTask: (...args: unknown[]) => runResearchTaskMock(...args),
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

import { runResearch, approveResearchOnly } from "./research-actions";

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
