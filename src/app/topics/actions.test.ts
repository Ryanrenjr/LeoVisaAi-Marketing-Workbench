import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn().mockResolvedValue({ id: "operator-1", role: "ADMIN" }) }));

const getTopicByIdMock = vi.fn();
vi.mock("@/lib/topics", () => ({ getTopicById: (...args: unknown[]) => getTopicByIdMock(...args) }));

/**
 * Same chainable + thenable Supabase query-builder stub as
 * research-actions.test.ts: each `.from(table)` call consumes the next
 * queued result for that table (in call order); `writes` records every
 * real insert()/update() payload, in call order, so tests can assert on
 * exactly what was written and to which table.
 */
const tableResults: Record<string, { data?: unknown; error?: unknown }[]> = {};
const tableCallIndex: Record<string, number> = {};
function queue(table: string, result: { data?: unknown; error?: unknown }) {
  (tableResults[table] ??= []).push(result);
}
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: fromMock }) }));

import { updateTopic } from "./actions";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const CURRENT_TOPIC = {
  id: "topic-1",
  title: "旧标题",
  question: "旧问题",
  business: "旧业务",
  audience: "旧受众",
  content_pillar: null,
  priority: "MEDIUM" as const,
  topic_score: 50,
  status: "RESEARCH_READY" as const,
};

const UNCHANGED_FIELDS = {
  title: CURRENT_TOPIC.title,
  question: CURRENT_TOPIC.question,
  business: CURRENT_TOPIC.business,
  audience: CURRENT_TOPIC.audience,
  priority: CURRENT_TOPIC.priority,
};

/**
 * Live audit finding: a research pack is grounded in the exact title/
 * question/audience/business it was researched against. Before this fix,
 * editing any of these while a pack already sat at RESEARCH_READY left
 * that (now describing a different topic) pack fully approvable —
 * approveResearchOnly/approve_research's own RESEARCH_READY-only gate is
 * the actual enforcement mechanism; updateTopic's job is just to make sure
 * the status genuinely reflects "needs fresh research" the moment a
 * research-relevant field changes, so that existing gate has correct
 * state to work from.
 */
describe("updateTopic — editing a research-relevant field at RESEARCH_READY forces the topic back to RESEARCHING", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
    writes = [];
  });

  it("sets status to RESEARCHING and records the status event when title changes at RESEARCH_READY", async () => {
    getTopicByIdMock.mockResolvedValue(CURRENT_TOPIC);
    queue("topics", { data: null, error: null });

    await updateTopic("topic-1", { error: null }, makeFormData({ ...UNCHANGED_FIELDS, title: "新标题" }));

    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect((topicUpdate!.payload as Record<string, unknown>).status).toBe("RESEARCHING");

    const statusEvent = writes.find((w) => w.table === "topic_status_events");
    expect(statusEvent?.payload).toMatchObject({
      topic_id: "topic-1",
      from_status: "RESEARCH_READY",
      to_status: "RESEARCHING",
    });
  });

  it("also invalidates on question/audience/business changes, individually", async () => {
    for (const [field, value] of [
      ["question", "新问题"],
      ["audience", "新受众"],
      ["business", "新业务"],
    ] as const) {
      vi.clearAllMocks();
      for (const key of Object.keys(tableResults)) delete tableResults[key];
      for (const key of Object.keys(tableCallIndex)) delete tableCallIndex[key];
      writes = [];
      getTopicByIdMock.mockResolvedValue(CURRENT_TOPIC);
      queue("topics", { data: null, error: null });

      await updateTopic("topic-1", { error: null }, makeFormData({ ...UNCHANGED_FIELDS, [field]: value }));

      const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
      expect((topicUpdate!.payload as Record<string, unknown>).status).toBe("RESEARCHING");
    }
  });

  it("does NOT touch status when only priority/content_pillar change — those aren't research-relevant", async () => {
    getTopicByIdMock.mockResolvedValue(CURRENT_TOPIC);
    queue("topics", { data: null, error: null });

    await updateTopic("topic-1", { error: null }, makeFormData({ ...UNCHANGED_FIELDS, priority: "HIGH" }));

    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect(topicUpdate?.payload).not.toHaveProperty("status");
    expect(writes.find((w) => w.table === "topic_status_events")).toBeUndefined();
  });

  it("does NOT touch status when a research-relevant field changes but the topic isn't at RESEARCH_READY", async () => {
    getTopicByIdMock.mockResolvedValue({ ...CURRENT_TOPIC, status: "CONTENT_DRAFT" });
    queue("topics", { data: null, error: null });

    await updateTopic("topic-1", { error: null }, makeFormData({ ...UNCHANGED_FIELDS, title: "新标题" }));

    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect(topicUpdate?.payload).not.toHaveProperty("status");
    expect(writes.find((w) => w.table === "topic_status_events")).toBeUndefined();
  });

  it("does NOT touch status when nothing actually changed", async () => {
    getTopicByIdMock.mockResolvedValue(CURRENT_TOPIC);
    queue("topics", { data: null, error: null });

    await updateTopic("topic-1", { error: null }, makeFormData({ ...UNCHANGED_FIELDS }));

    const topicUpdate = writes.find((w) => w.table === "topics" && w.method === "update");
    expect(topicUpdate?.payload).not.toHaveProperty("status");
  });
});
