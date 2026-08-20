"use client";

import { useActionState } from "react";
import { CONTENT_PILLAR_LABEL, PRIORITY_LABEL } from "@/lib/status";
import type { ContentPillar, TopicPriority } from "@/lib/types";
import type { TopicFormState } from "@/app/topics/actions";
import { Button } from "./ui/button";

const PILLAR_OPTIONS = Object.entries(CONTENT_PILLAR_LABEL) as [ContentPillar, string][];
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABEL) as [TopicPriority, string][];

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm";

export interface TopicFormInitial {
  title?: string;
  question?: string;
  business?: string;
  audience?: string;
  content_pillar?: ContentPillar | null;
  priority?: TopicPriority;
  topic_score?: number;
}

export function TopicForm({
  action,
  initial,
  submitLabel,
  showScoreField = false,
  disabled = false,
}: {
  action: (prevState: TopicFormState, formData: FormData) => Promise<TopicFormState>;
  initial?: TopicFormInitial;
  submitLabel: string;
  showScoreField?: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  if (disabled) {
    return (
      <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
        当前为演示数据（未连接 Supabase），新建/编辑已禁用。
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        标题
        <input name="title" defaultValue={initial?.title} required className={inputClass} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        选题问题
        <textarea
          name="question"
          defaultValue={initial?.question}
          required
          rows={2}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          业务线
          <input name="business" defaultValue={initial?.business} className={inputClass} placeholder="例如：永居 / ILR" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          目标受众
          <input name="audience" defaultValue={initial?.audience} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          内容支柱
          <select
            name="content_pillar"
            defaultValue={initial?.content_pillar ?? ""}
            className={inputClass}
          >
            <option value="">未设置</option>
            {PILLAR_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          优先级
          <select
            name="priority"
            defaultValue={initial?.priority ?? "MEDIUM"}
            className={inputClass}
          >
            {PRIORITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showScoreField && (
        <label className="flex flex-col gap-1 text-sm">
          选题评分（可手动调整，0–100）
          <input
            name="topic_score"
            type="number"
            min={0}
            max={100}
            defaultValue={initial?.topic_score}
            className={`${inputClass} sm:w-40`}
          />
        </label>
      )}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
