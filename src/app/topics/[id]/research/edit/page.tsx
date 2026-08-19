import { notFound } from "next/navigation";
import { getLatestResearchPack, getTopicById } from "@/lib/topics";
import { ResearchEditForm } from "@/components/research-edit-form";

export default async function EditResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [topic, pack] = await Promise.all([getTopicById(id), getLatestResearchPack(id)]);
  if (!topic || !pack) notFound();

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-lg font-semibold">编辑研究成果 · {topic.code}</h1>
      <p className="text-sm text-[var(--muted)]">
        仅可编辑摘要、关键发现与注意事项文字 —
        来源列表不可在此手动添加或修改，只能来自“运行研究”找到的真实搜索结果，以避免引入未经核实的链接。
      </p>
      <ResearchEditForm
        topicId={topic.id}
        packId={pack.id}
        initial={{ summary: pack.summary, keyFindings: pack.key_findings, warnings: pack.warnings }}
      />
    </div>
  );
}
