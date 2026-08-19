import { TopicForm } from "@/components/topic-form";
import { isDemoMode } from "@/lib/topics";
import { createTopic } from "../actions";

export default async function NewTopicPage() {
  const demo = await isDemoMode();

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-lg font-semibold">新建选题</h1>
      <TopicForm action={createTopic} submitLabel="创建" disabled={demo} />
    </div>
  );
}
