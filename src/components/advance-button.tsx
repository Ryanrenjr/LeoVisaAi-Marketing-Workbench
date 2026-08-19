import { advanceTopicStatus } from "@/app/actions";
import { STATUS_LABEL } from "@/lib/status";
import { nextStatus } from "@/lib/topic-workflow";
import type { Topic } from "@/lib/types";
import { Button } from "./ui/button";

export function AdvanceButton({ topic }: { topic: Topic }) {
  const to = nextStatus(topic.status);
  if (!to) return null;

  const advance = advanceTopicStatus.bind(null, topic.id, topic.status);

  return (
    <form action={advance}>
      <Button type="submit" variant="secondary" className="whitespace-nowrap text-xs">
        标记为{STATUS_LABEL[to]}
      </Button>
    </form>
  );
}
