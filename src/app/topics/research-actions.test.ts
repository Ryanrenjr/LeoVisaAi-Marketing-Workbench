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
function chainable(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    insert: () => builder,
    update: () => builder,
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
  return chainable(results[idx] ?? { data: null, error: null });
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

import { runResearch } from "./research-actions";

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
