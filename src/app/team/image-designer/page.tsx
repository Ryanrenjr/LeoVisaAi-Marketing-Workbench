import { getAllContentAssets, getAllTopics, isDemoMode } from "@/lib/topics";
import { getCurrentUser } from "@/lib/auth";
import { groupContentAssetsByTopicId, getLatestForLineage } from "@/lib/content-versions";
import { getContentImagesForTopic } from "@/lib/content-images";
import { canManageContentAssets } from "@/lib/permissions";
import { filterContentEligibleTopics } from "@/lib/employee-tasks";
import { getEmployee, resolveEmployeeDisplayName } from "@/lib/boss-language";
import { getEmployeeNames } from "@/lib/employee-names";
import { EmployeeHeader } from "@/components/employee-header";
import { getTaskModelOptions } from "@/lib/ai/task-model-options";
import { GenerateAction } from "@/components/ai/generate-action";
import { ContentImageGrid } from "@/components/content/content-image-grid";
import { generateCoverImage } from "./actions";
import type { Topic } from "@/lib/types";

async function TopicRow({
  topic,
  modelOptions,
}: {
  topic: Topic;
  modelOptions: Awaited<ReturnType<typeof getTaskModelOptions>> | null;
}) {
  const images = await getContentImagesForTopic(topic.id);

  return (
    <li className="card flex flex-col gap-3 px-5 py-4">
      <p className="font-medium">{topic.title}</p>

      <ContentImageGrid images={images} />

      {modelOptions && (
        <GenerateAction
          action={async (override) => {
            "use server";
            await generateCoverImage(topic.id, override);
          }}
          label={images.length > 0 ? "再生成一张" : "生成配图"}
          taskType="IMAGE_GENERATION"
          models={modelOptions.models}
          defaultModel={modelOptions.defaultModel}
          resolutionError={modelOptions.resolutionError}
        />
      )}
    </li>
  );
}

export default async function ImageDesignerPage() {
  const employee = getEmployee("image-designer");
  const [allTopics, allContentAssets, demo, employeeNames, user] = await Promise.all([
    getAllTopics(),
    getAllContentAssets(),
    isDemoMode(),
    getEmployeeNames(),
    getCurrentUser(),
  ]);
  const employeeName = resolveEmployeeDisplayName("image-designer", employeeNames);

  const assetsByTopicId = groupContentAssetsByTopicId(allContentAssets);
  // Only topics that already have a reviewed 小红书 text draft — an image
  // is designed FROM that draft, never generated ahead of it.
  const eligibleTopics = filterContentEligibleTopics(allTopics)
    .filter((t) => getLatestForLineage(assetsByTopicId.get(t.id) ?? [], "XIAOHONGSHU", "xiaohongshu_post"))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const canRun = !demo && user && canManageContentAssets(user.role);
  const modelOptions = canRun ? await getTaskModelOptions("IMAGE_GENERATION") : null;

  return (
    <div className="flex flex-col gap-8">
      <EmployeeHeader
        avatarId="image-designer"
        letter={employee.letter}
        name={employeeName}
        subtitle="根据已经写好的小红书文字，生成配图。"
      />

      {demo && (
        <p className="card px-4 py-3 text-sm text-[var(--muted)]">
          当前为演示数据（未连接 Supabase），配图生成已禁用。
        </p>
      )}

      {eligibleTopics.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">暂无已写好小红书文字、可以生成配图的选题。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {eligibleTopics.map((topic) => (
            <TopicRow key={topic.id} topic={topic} modelOptions={modelOptions} />
          ))}
        </ul>
      )}
    </div>
  );
}
