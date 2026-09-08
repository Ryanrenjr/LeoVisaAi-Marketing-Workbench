import { isDemoMode } from "@/lib/topics";
import { timeBasedGreeting, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { LaneCard, LaneGroup, StageRow } from "@/components/pipeline-flow";
import { GenerationRunner } from "@/components/generation-runner";
import Link from "next/link";
import type { ContentPlatform } from "@/lib/types";

const ALL_PLATFORMS: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];

function DemoNotice() {
  return (
    <p className="card px-4 py-3 text-sm text-[var(--muted)]">
      当前为演示数据（未连接 Supabase）。配置 .env.local 后将显示真实数据。
    </p>
  );
}

async function BossHome({
  demo,
  generatingTopicId,
  generatingPlatforms,
}: {
  demo: boolean;
  generatingTopicId: string | null;
  generatingPlatforms: ContentPlatform[];
}) {
  const employeeNames = await getEmployeeNames();

  const greeting = timeBasedGreeting(new Date().getHours());

  return (
    <div className="flex flex-col gap-10">
      {demo && <DemoNotice />}

      <section className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}。</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">你的数字团队正在工作。</p>
        </div>
        <Link
          href="/team/handbook"
          className="shrink-0 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]"
        >
          📖 数字员工手册
        </Link>
      </section>

      {generatingTopicId && (
        <GenerationRunner topicId={generatingTopicId} employeeNames={employeeNames} platforms={generatingPlatforms} />
      )}

      <section className="flex flex-col gap-1">
        <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">工作流程 · 共 9 步</h2>

        <StageRow
          avatarId="planner"
          step={1}
          name={resolveEmployeeDisplayName("planner", employeeNames)}
          actionLabel="搜索选题"
          href="/team/planner"
          kind="auto"
        />
        <StageRow
          avatarId="researcher"
          step={2}
          name={resolveEmployeeDisplayName("researcher", employeeNames)}
          actionLabel="查看研究"
          href="/team/researcher"
          kind="auto"
        />
        <LaneGroup step={3} label="研究确认后，按选定平台一起写文案">
          <LaneCard
            avatarId="video-editor"
            name={resolveEmployeeDisplayName("video-editor", employeeNames)}
            href="/team/video-editor"
          />
          <LaneCard
            avatarId="xiaohongshu-editor"
            name={resolveEmployeeDisplayName("xiaohongshu-editor", employeeNames)}
            href="/team/xiaohongshu-editor"
          />
          <LaneCard
            avatarId="wechat-editor"
            name={resolveEmployeeDisplayName("wechat-editor", employeeNames)}
            href="/team/wechat-editor"
          />
        </LaneGroup>

        <StageRow
          avatarId="compliance"
          step={4}
          name={resolveEmployeeDisplayName("compliance", employeeNames)}
          actionLabel="查看合规"
          href="/team/compliance"
          kind="auto"
        />
        <StageRow
          avatarId="reviser"
          step={5}
          name={resolveEmployeeDisplayName("reviser", employeeNames)}
          actionLabel="查看修改"
          href="/team/reviser"
          kind="conditional"
          conditionalText="有问题才执行"
        />
        <StageRow
          avatarId="compliance"
          step={6}
          name={`${resolveEmployeeDisplayName("compliance", employeeNames)}（终审复核）`}
          actionLabel="查看复核"
          href="/team/compliance"
          kind="conditional"
          conditionalText="改过才复核"
        />
        <StageRow
          avatarId="xiaohongshu-image-planner"
          step={7}
          name={resolveEmployeeDisplayName("xiaohongshu-image-planner", employeeNames)}
          actionLabel="查看规划"
          href="/team/xiaohongshu-image-planner"
          kind="conditional"
          conditionalText="仅选小红书时执行"
        />
        <StageRow
          avatarId="image-designer"
          step={8}
          name={resolveEmployeeDisplayName("image-designer", employeeNames)}
          actionLabel="查看配图"
          href="/team/image-designer"
          kind="auto"
        />
        <StageRow
          avatarId="integrator"
          step={9}
          name={resolveEmployeeDisplayName("integrator", employeeNames)}
          actionLabel="查看整合"
          href="/team/integrator"
          kind="auto"
          last
        />
      </section>
    </div>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ generating?: string; platforms?: string }>;
}) {
  const [demo, { generating, platforms }] = await Promise.all([isDemoMode(), searchParams]);
  const generatingPlatforms = ALL_PLATFORMS.includes(platforms as ContentPlatform)
    ? [platforms as ContentPlatform]
    : ALL_PLATFORMS;
  return <BossHome demo={demo} generatingTopicId={generating ?? null} generatingPlatforms={generatingPlatforms} />;
}
