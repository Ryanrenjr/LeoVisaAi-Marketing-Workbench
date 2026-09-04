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
} from "@/app/topics/pipeline-actions";
import { resolveEmployeeDisplayName } from "@/lib/boss-language";
import { Button } from "@/components/ui/button";
import type { EmployeeId } from "@/lib/boss-language";

type StepKey = "content" | "compliance" | "revision" | "planning" | "images";
type StepStatus = "pending" | "active" | "done" | "skipped";

interface StepDef {
  key: StepKey;
  label: string;
  employees: EmployeeId[];
  /** The percentage this step's progress bar climbs toward while running, and jumps to the instant it completes. */
  ceiling: number;
}

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
const STEPS: StepDef[] = [
  { key: "content", label: "生成三平台文案", employees: ["video-editor", "xiaohongshu-editor", "wechat-editor"], ceiling: 20 },
  { key: "compliance", label: "合规审核", employees: ["compliance"], ceiling: 40 },
  { key: "revision", label: "按审核意见校对修改", employees: ["reviser"], ceiling: 60 },
  { key: "planning", label: "小红书图文规划", employees: ["xiaohongshu-image-planner"], ceiling: 75 },
  { key: "images", label: "生成配图（封面 + 图文）", employees: ["image-designer"], ceiling: 100 },
];

/**
 * "选题确认之后，直接从内容到最后一步整合" + "工作的时候要加上百分比，最好
 * 再首页加上每个员工工作的样子" + "这个过程要把流程也写上，先哪个后哪个，
 * 然后进度。图文规划也要加进去，生图也要加上，封面所有的" (live user
 * instructions) — mounted on the home page whenever `?generating=<topicId>`
 * is present (see `approveAndGoHome` in pipeline-actions.ts), this runs
 * all five generation steps client-side, one at a time, showing the full
 * step sequence (done/active/pending), which digital employee is
 * currently working, and a percentage that climbs toward each step's
 * ceiling the same "decelerating estimate" way `ThinkingRow` already does
 * (there's no real progress signal from a single AI call), then jumps to
 * that step's real completion value once the step's server action
 * actually resolves.
 */
export function GenerationRunner({
  topicId,
  employeeNames,
}: {
  topicId: string;
  employeeNames: Partial<Record<EmployeeId, string>>;
}) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [skippedRevision, setSkippedRevision] = useState(false);
  const [percent, setPercent] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const ceilingRef = useRef(STEPS[0].ceiling);
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

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function run() {
      try {
        setActiveIndex(0);
        ceilingRef.current = STEPS[0].ceiling;
        await runContentGenerationStep(topicId);
        setPercent(STEPS[0].ceiling);
        await waitIfPaused();

        setActiveIndex(1);
        ceilingRef.current = STEPS[1].ceiling;
        const { anyFlagged } = await runComplianceStep(topicId);
        setPercent(STEPS[1].ceiling);
        await waitIfPaused();

        if (anyFlagged) {
          setActiveIndex(2);
          ceilingRef.current = STEPS[2].ceiling;
          await runRevisionStep(topicId);
          setPercent(STEPS[2].ceiling);
        } else {
          setSkippedRevision(true);
        }
        await waitIfPaused();

        setActiveIndex(3);
        ceilingRef.current = STEPS[3].ceiling;
        await runImagePlanningStep(topicId);
        setPercent(STEPS[3].ceiling);
        await waitIfPaused();

        setActiveIndex(4);
        ceilingRef.current = STEPS[4].ceiling;
        await runImageGenerationStep(topicId);

        setPercent(100);
        setActiveIndex(STEPS.length);
        // A beat before navigating away — otherwise the 100% state never
        // actually gets seen (setPercent/router.push land in the same
        // tick). Live user instruction: "生产过程有游戏感" — completing the
        // whole pipeline deserves a visible moment, not an instant cut.
        await new Promise((resolve) => setTimeout(resolve, 550));
        router.push("/team/integrator");
      } catch (err) {
        setError(err instanceof Error ? err.message : "生成过程中出错了。");
      }
    }

    run();
  }, [topicId, router]);

  if (error) {
    return (
      <div className="card flex flex-col gap-2 px-5 py-4 text-sm">
        <p className="font-medium text-red-700 dark:text-red-400">生成过程中出错了</p>
        <p className="text-[var(--muted)]">{error}</p>
      </div>
    );
  }

  const allDone = activeIndex >= STEPS.length;
  const activeEmployees = allDone ? [] : STEPS[activeIndex].employees;

  return (
    <div className="card flex flex-col gap-4 px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {allDone ? "完成，正在跳转…" : paused ? "已暂停…" : STEPS[activeIndex].label + "…"}
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
        {STEPS.map((s, i) => {
          const status: StepStatus =
            i === 2 && skippedRevision
              ? "skipped"
              : i < activeIndex || allDone
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending";
          const isLast = i === STEPS.length - 1;
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
