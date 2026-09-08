"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  runContentGenerationStep,
  runImagePlanningStep,
  runImageGenerationStep,
  runComplianceStep,
  runRevisionStep,
  getOrCreateGenerationRun,
  markGenerationRunStep,
  completeGenerationRun,
  failGenerationRun,
  retryGenerationRun,
} from "@/app/topics/pipeline-actions";
import type { GenerationRun } from "@/app/topics/pipeline-actions";
import { discardTopic } from "@/app/topics/actions";
import { resolveEmployeeDisplayName } from "@/lib/boss-language";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type { EmployeeId } from "@/lib/boss-language";
import type { ContentPlatform } from "@/lib/types";

/** A step's executor gets this many total attempts (1 real + 2 automatic retries) before a transient error (429, network blip) is surfaced to a human — cheap because subtask-level idempotency (see executors below, and generateContent/generateCrossPlatformCover/etc.'s `since` param) means a retry skips whatever already succeeded instead of re-running it. */
const STEP_ATTEMPT_DELAYS_MS = [2000, 5000];

async function withStepRetry(run: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      if (attempt >= STEP_ATTEMPT_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, STEP_ATTEMPT_DELAYS_MS[attempt]));
    }
  }
}

type StepKey = "content" | "compliance" | "revision" | "planning" | "images";
type StepStatus = "pending" | "active" | "done" | "skipped";

interface StepDef {
  key: StepKey;
  label: string;
  employees: EmployeeId[];
  /** The percentage this step's progress bar climbs toward while running, and jumps to the instant it completes. */
  ceiling: number;
}

const PLATFORM_WRITER: Record<ContentPlatform, EmployeeId> = {
  VIDEO_CHANNEL: "video-editor",
  XIAOHONGSHU: "xiaohongshu-editor",
  WECHAT_OFFICIAL_ACCOUNT: "wechat-editor",
};

/**
 * Relative weight per step, renormalized to 100 over whichever steps are
 * actually included for this run (live user instruction: "可以有一个选择
 * ...出小红书图文/出视频号口播/出公众号文字/一键全出" — when 小红书 isn't
 * picked, the "planning" step (K's page plan) doesn't apply at all, so the
 * step list itself varies, not just which platforms get generated).
 */
const STEP_WEIGHT: Record<StepKey, number> = { content: 20, compliance: 20, revision: 20, planning: 15, images: 25 };

/**
 * Order matters here, and it's not arbitrary: text has to be reviewed and
 * (if flagged) revised — which inserts a NEW `content_assets` version,
 * same versioning every regenerate/edit already uses — before images get
 * generated, because an image is saved against one specific version's id
 * (`content_images.content_asset_id`). Generating images first (an
 * earlier version of this runner did) orphans them the moment revision
 * creates a newer version: the cover is still in the database, just
 * attached to a version nothing shows anymore. Text has to be final
 * before anything gets drawn.
 */
function buildSteps(platforms: ContentPlatform[]): StepDef[] {
  const keys: StepKey[] = platforms.includes("XIAOHONGSHU")
    ? ["content", "compliance", "revision", "planning", "images"]
    : ["content", "compliance", "revision", "images"];

  const totalWeight = keys.reduce((sum, key) => sum + STEP_WEIGHT[key], 0);
  const contentLabel =
    platforms.length === 3 ? "生成三平台文案" : `生成${platforms.map((p) => CONTENT_PLATFORM_LABEL[p]).join("/")}文案`;
  const LABEL: Record<StepKey, string> = {
    content: contentLabel,
    compliance: "合规审核",
    revision: "按审核意见校对修改",
    planning: "小红书图文规划",
    images: "生成配图（封面 + 图文）",
  };
  const EMPLOYEES: Record<StepKey, EmployeeId[]> = {
    content: platforms.map((p) => PLATFORM_WRITER[p]),
    compliance: ["compliance"],
    revision: ["reviser"],
    planning: ["xiaohongshu-image-planner"],
    images: ["image-designer"],
  };

  let cumulative = 0;
  return keys.map((key) => {
    cumulative += STEP_WEIGHT[key];
    return { key, label: LABEL[key], employees: EMPLOYEES[key], ceiling: Math.round((cumulative / totalWeight) * 100) };
  });
}

/**
 * "选题确认之后，直接从内容到最后一步整合" + "工作的时候要加上百分比，最好
 * 再首页加上每个员工工作的样子" + "这个过程要把流程也写上，先哪个后哪个，
 * 然后进度。图文规划也要加进去，生图也要加上，封面所有的" + "可以有一个选择
 * ...出小红书图文/出视频号口播/出公众号文字/一键全出" + a live audit
 * finding (P0: refresh mid-pipeline re-ran everything from scratch,
 * re-billing AI calls) — mounted on the home page whenever
 * `?generating=<topicId>` is present (see `approveAndGoHome` in
 * pipeline-actions.ts). Two-phase mount: first fetch-or-create the
 * persisted `generation_runs` row for this topic (getOrCreateGenerationRun
 * — same row survives a refresh, so a re-mount resumes instead of
 * restarting), then run whichever steps aren't in that row's
 * `completed_steps` yet, showing the full step sequence
 * (done/active/pending), which digital employee is currently working, and
 * a percentage that climbs toward each step's ceiling the same
 * "decelerating estimate" way `ThinkingRow` already does (there's no real
 * progress signal from a single AI call), then jumps to that step's real
 * completion value once the step's server action actually resolves.
 */
export function GenerationRunner({
  topicId,
  employeeNames,
  platforms: requestedPlatforms,
}: {
  topicId: string;
  employeeNames: Partial<Record<EmployeeId, string>>;
  platforms: ContentPlatform[];
}) {
  const router = useRouter();
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [skippedRevision, setSkippedRevision] = useState(false);
  const [percent, setPercent] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const ceilingRef = useRef(1);
  const initRef = useRef(false);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);

  /** Can only take effect between steps — a Server Action already in flight can't be interrupted mid-call, so "暂停" means "finish the step that's running, then wait" rather than freezing instantly. */
  function waitIfPaused(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!pausedRef.current) {
          resolve();
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current) return;
      setPercent((prev) => {
        const ceiling = ceilingRef.current;
        if (prev >= ceiling) return prev;
        return Math.min(ceiling, prev + Math.max(1, Math.round((ceiling - prev) * 0.15)));
      });
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // Phase 1 — resolve (or create) the persisted run before doing any work.
  // A "failed" run still gets setRun (not just setError): the error card
  // below needs run.id to offer a "重试当前步骤" button, and Phase 2 reads
  // run.status itself to decide whether to actually execute anything.
  async function loadRun() {
    try {
      const loaded = await getOrCreateGenerationRun(topicId, requestedPlatforms);
      if (loaded.status === "done") {
        router.push("/team/integrator");
        return;
      }
      setError(loaded.status === "failed" ? (loaded.error ?? "生成过程中出错了。") : null);
      setRun(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "初始化生成过程失败。");
    }
  }

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    loadRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    // No run yet means loadRun itself failed (e.g. couldn't reach the DB
    // to create the row) — re-run it instead of retryGenerationRun, which
    // needs an existing run.id.
    if (!run) {
      await loadRun();
      return;
    }
    try {
      const refreshed = await retryGenerationRun(run.id);
      setError(null);
      startedRef.current = false;
      setRun(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败，请刷新页面再试。");
    }
  }

  // Phase 2 — once the run is known AND running, execute whichever steps
  // aren't in its completed_steps yet. Runs at most once per run.id
  // (startedRef; handleRetry resets it to allow a second pass).
  useEffect(() => {
    if (!run || run.status !== "running" || startedRef.current) return;
    startedRef.current = true;

    const steps = buildSteps(run.platforms);
    const resumeFromIndex = steps.findIndex((s) => !run.completedSteps.includes(s.key));
    const startIndex = resumeFromIndex === -1 ? steps.length : resumeFromIndex;

    // `since` = this run's creation time, so a retried step's underlying
    // generator (generateContent / generateCrossPlatformCover / etc.) can
    // tell "already produced in this run, don't redo it" apart from "an
    // older version from before this run started, still needs doing" —
    // see each function's own doc comment for the exact table it checks.
    // `run.id` additionally gives each subtask an atomic claim (round 6,
    // src/lib/generation-run-tasks.ts) — since only closes the retry-
    // level race, the claim closes the concurrent-request-level one.
    const since = run.createdAt;
    const runId = run.id;
    const executors: Record<StepKey, () => Promise<void>> = {
      content: () => runContentGenerationStep(topicId, run.platforms, since, runId),
      compliance: async () => {
        await runComplianceStep(topicId, runId);
      },
      // Determined fresh from the DB every time (see runRevisionStep's doc
      // comment) — correct whether this is a normal run or a resume that
      // landed exactly between compliance finishing and revision starting.
      revision: async () => {
        const { skipped } = await runRevisionStep(topicId, runId);
        if (skipped) setSkippedRevision(true);
      },
      planning: () => runImagePlanningStep(topicId, since, runId),
      images: () => runImageGenerationStep(topicId, run.platforms, since, runId),
    };

    async function runFrom(from: number) {
      try {
        // Resuming partway through — seed the bar to reflect what's
        // already done before the loop's first iteration starts climbing
        // toward the next step's ceiling. (When from === 0 this is a
        // no-op: steps[-1] is undefined, so percent stays at its initial 1.)
        if (from > 0) {
          setPercent(steps[from - 1].ceiling);
          ceilingRef.current = steps[from]?.ceiling ?? 100;
        }

        for (let i = from; i < steps.length; i++) {
          setActiveIndex(i);
          ceilingRef.current = steps[i].ceiling;
          await withStepRetry(executors[steps[i].key]);
          setPercent(steps[i].ceiling);
          await markGenerationRunStep(run!.id, steps[i].key);
          await waitIfPaused();
        }

        await completeGenerationRun(run!.id);
        setPercent(100);
        setActiveIndex(steps.length);
        // A beat before navigating away — otherwise the 100% state never
        // actually gets seen (setPercent/router.push land in the same
        // tick). Live user instruction: "生产过程有游戏感" — completing the
        // whole pipeline deserves a visible moment, not an instant cut.
        await new Promise((resolve) => setTimeout(resolve, 550));
        router.push("/team/integrator");
      } catch (err) {
        const message = err instanceof Error ? err.message : "生成过程中出错了。";
        setError(message);
        await failGenerationRun(run!.id, message).catch(() => {});
      }
    }

    runFrom(startIndex);
  }, [run, topicId, router]);

  if (error) {
    return (
      <div className="card flex flex-col gap-3 px-5 py-4 text-sm">
        <div className="flex flex-col gap-2">
          <p className="font-medium text-red-700 dark:text-red-400">生成过程中出错了</p>
          <p className="text-[var(--muted)]">{error}</p>
        </div>
        <div className="flex gap-3">
          <form action={discardTopic.bind(null, topicId)} className="flex-1">
            <PendingSubmitButton variant="secondary" className="w-full">
              结束并清空
            </PendingSubmitButton>
          </form>
          <Button type="button" className="flex-1" onClick={handleRetry}>
            重试当前步骤
          </Button>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-[var(--muted)]">
        <span className="thinking-avatar inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
        正在准备生成流程…
      </div>
    );
  }

  const steps = buildSteps(run.platforms);
  const allDone = activeIndex >= steps.length;
  const activeEmployees = allDone ? [] : steps[activeIndex].employees;
  const revisionIndex = steps.findIndex((s) => s.key === "revision");

  return (
    <div className="card flex flex-col gap-4 px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {allDone ? "完成，正在跳转…" : paused ? "已暂停…" : steps[activeIndex].label + "…"}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-[var(--accent)]">{percent}%</span>
          {!allDone && (
            <Button type="button" variant="secondary" className="px-3 py-1 text-xs" onClick={togglePause}>
              {paused ? "继续" : "暂停"}
            </Button>
          )}
        </div>
      </div>

      {paused && !allDone && (
        <p className="text-xs text-[var(--muted)]">
          当前这一步做完就会停下来等你——已经发出去的 AI 调用没法中途叫停，点「继续」才会开始下一步。
        </p>
      )}

      <div className={`h-2 w-full overflow-hidden rounded-full bg-[var(--border)] ${percent >= 100 ? "pop-in" : ""}`}>
        <div
          className={`relative h-full overflow-hidden rounded-full transition-all ${paused ? "bg-[var(--muted)]" : "bg-[var(--accent)]"}`}
          style={{ width: `${percent}%` }}
        >
          {!paused && !allDone && (
            <div className="absolute inset-y-0 w-1/3 bg-white/30" style={{ animation: "progress-shimmer 1.6s ease-in-out infinite" }} />
          )}
        </div>
      </div>

      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const status: StepStatus =
            i === revisionIndex && skippedRevision
              ? "skipped"
              : i < activeIndex || allDone
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending";
          const isLast = i === steps.length - 1;
          const connectorFilled = status === "done" || status === "skipped";
          return (
            <li key={s.key} className="flex gap-3">
              <div className="flex flex-shrink-0 flex-col items-center">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 ${
                    status === "done"
                      ? "pop-in bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : status === "active"
                        ? "thinking-avatar border-2 border-[var(--accent)] text-[var(--accent)]"
                        : status === "skipped"
                          ? "bg-[var(--border)] text-[var(--muted)]"
                          : "border border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {status === "done" ? "✓" : status === "active" ? "●" : status === "skipped" ? "—" : "○"}
                </span>
                {!isLast && (
                  <div
                    className={`w-0.5 flex-1 transition-colors duration-500 ${connectorFilled ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
                    style={{ minHeight: 14 }}
                  />
                )}
              </div>
              <div className={`pb-3 text-sm ${status === "pending" || status === "skipped" ? "text-[var(--muted)]" : ""}`}>
                {s.label}
                {status === "skipped" && "（审核无问题，跳过）"}
              </div>
            </li>
          );
        })}
      </ol>

      {activeEmployees.length > 0 && (
        // key={activeIndex} forces a remount when the step changes, so the
        // fade-in-up entrance replays for each new step's employees
        // instead of only playing once on the runner's first mount —
        // reads as the next employee(s) "stepping in" to take over.
        <div key={activeIndex} className="flex gap-4">
          {activeEmployees.map((id) => (
            <div key={id} className="flex flex-col items-center gap-1" style={{ animation: "fade-in-up 0.3s ease-out both" }}>
              <Image
                src={`/employees/${id}.png`}
                alt=""
                width={40}
                height={40}
                className="thinking-avatar h-10 w-10 rounded-full object-cover"
              />
              <span className="text-xs text-[var(--muted)]">{resolveEmployeeDisplayName(id, employeeNames)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
