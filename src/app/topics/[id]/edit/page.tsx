import { notFound } from "next/navigation";
import { getTopicById, isDemoMode } from "@/lib/topics";
import { TopicForm } from "@/components/topic-form";
import { updateTopic } from "../../actions";

export default async function EditTopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [topic, demo] = await Promise.all([getTopicById(id), isDemoMode()]);
  if (!topic) notFound();

  const boundUpdate = updateTopic.bind(null, topic.id);

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-lg font-semibold">编辑选题 · {topic.code}</h1>
      <TopicForm
        action={boundUpdate}
        submitLabel="保存"
        showScoreField
        disabled={demo}
        initial={{
          title: topic.title,
          question: topic.question,
          business: topic.business,
          audience: topic.audience,
          content_pillar: topic.content_pillar,
          priority: topic.priority,
          topic_score: topic.topic_score,
        }}
      />
    </div>
  );
}
