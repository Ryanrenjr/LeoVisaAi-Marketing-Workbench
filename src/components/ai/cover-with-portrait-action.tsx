"use client";

import { useState } from "react";
import { GenerateAction, type OverridableModel } from "./generate-action";
import { generateCrossPlatformCover } from "@/app/team/image-designer/actions";
import type { AIProviderId } from "@/lib/ai/providers/types";

/**
 * 小红书/视频封面 generation, plus the "带李尔王特写" toggle — the one place
 * a generation button needs an extra per-click option beyond the shared
 * model override GenerateAction already handles, so this wraps it rather
 * than growing GenerateAction's props for every other call site too.
 * Defaults to on: 小红书/视频封面一般都需要带特写 (live user instruction).
 */
export function CoverWithPortraitAction({
  topicId,
  hasPortraits,
  models,
  defaultModel,
  resolutionError,
}: {
  topicId: string;
  hasPortraits: boolean;
  models: OverridableModel[];
  defaultModel: OverridableModel | null;
  resolutionError: string | null;
}) {
  const [includePortrait, setIncludePortrait] = useState(hasPortraits);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <input
          type="checkbox"
          checked={includePortrait}
          disabled={!hasPortraits}
          onChange={(e) => setIncludePortrait(e.target.checked)}
        />
        带李尔王特写{!hasPortraits && "（还没上传照片，见下方「李尔王特写照片」）"}
      </label>
      <GenerateAction
        action={async (override: { provider: AIProviderId; modelId: string } | null) => {
          return generateCrossPlatformCover(topicId, includePortrait, override);
        }}
        label="生成小红书/视频封面"
        variant="secondary"
        taskType="IMAGE_GENERATION"
        models={models}
        defaultModel={defaultModel}
        resolutionError={resolutionError}
      />
    </div>
  );
}
