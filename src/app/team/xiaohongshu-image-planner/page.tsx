import Link from "next/link";
import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { canManageContentAssets } from "@/lib/permissions";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { getTaskModelOptions } from "@/lib/ai/task-model-options";
import { EmployeeHeader } from "@/components/employee-header";
import { GenerateAction } from "@/components/ai/generate-action";
import { generatePagesPlan } from "./actions";
import type { XiaohongshuPagesPlan } from "@/lib/ai/content-schemas";
import type { ContentAsset, Topic } from "@/lib/types";

/**
 * Employee K（小红书图文规划员）— writes ONLY the P1–Pn text plan for a 小红书
 * 图文 carousel (what each page says, what its design direction should be).
 * Live user instruction (correction): K does not generate images itself —
 * that button lives on E｜图片设计员's own page, reading K's plan. See
 * docs/digital-employee-skills.md "K｜小红书图文规划员".
 */
function TopicRow({
  topic,
  assets,
  canRun,
  planModelOptions,
}: {
  topic: Topic;
  assets: ContentAsset[];
  canRun: boolean;
  planModelOptions: Awaited<ReturnType<typeof getTaskModelOptions>> | null;
}) {
  const plan = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_pages");
  const planContent = plan?.structured_content as unknown as XiaohongshuPagesPlan | undefined;

  return (
    <li className="card flex flex-col gap-3 px-5 py-4">
      <Link href={`/topics/${topic.id}?tab=xiaohongshu`} className="font-medium hover:underline">
        {topic.title}
      </Link>
      <p className="text-xs text-[var(--muted)]">
        {planContent ? `图文规划：共 ${planContent.pages.length} 页 · v${plan!.version}` : "图文规划：待生成"}
      </p>

      {planContent && (
        <ol className="flex flex-col gap-2 text-sm">
          {planContent.pages.map((page, i) => (
            <li key={i} className="rounded-md border border-[var(--border)] px-3 py-2">
              <span className="text-xs text-[var(--muted)]">P{i + 1}</span>
              <p>{page}</p>
            </li>
          ))}
        </ol>
      )}

      {canRun && planModelOptions && (
        <GenerateAction
          action={async (override) => {
            "use server";
            return generatePagesPlan(topic.id, override);
          }}
          label={plan ? "重新生成图文规划" : "生成图文规划"}
          variant={plan ? "secondary" : "primary"}
          taskType="XIAOHONGSHU_PAGES_PLANNING"
          models={planModelOptions.models}
          defaultModel={planModelOptions.defaultModel}
          resolutionError={planModelOptions.resolutionError}
        />
      )}
    </li>
  );
}

export default async function XiaohongshuImagePlannerPage() {
  const employee = getEmployee("xiaohongshu-image-planner");
  const [allTopics, allContentAssets, demo, employeeNames, user] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    isDemoMode(),
    getEmployeeNames(),
    getCurrentUser(),
  ]);
  const employeeName = resolveEmployeeDisplayName("xiaohongshu-image-planner", employeeNames);

  const eligibleTopics = filterContentEligibleTopics(allTopics).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);
  const canRun = !demo && user && canManageContentAssets(user.role);
  const planModelOptions = canRun ? await getTaskModelOptions("XIAOHONGSHU_PAGES_PLANNING") : null;

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="xiaohongshu-image-planner"
        letter={employee.letter}
        name={employeeName}
        subtitle="规划小红书图文每一页写什么、怎么设计（P1 是什么、P2 怎么设计……），实际配图由小红书图片设计员生成。"
      />

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">当前为演示数据（未连接 Supabase）。</p>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已确认研究、可以生成内容的选题。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {eligibleTopics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              assets={assetsByTopicId.get(topic.id) ?? []}
              canRun={Boolean(canRun)}
              planModelOptions={planModelOptions}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
