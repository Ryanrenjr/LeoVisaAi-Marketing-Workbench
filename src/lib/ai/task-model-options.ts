import "server-only";
import { listModelsForTask, isProviderConfigured } from "./providers/registry";
import { resolveModelForTask } from "./router";
import type { TaskType } from "./providers/types";
import type { OverridableModel } from "@/components/ai/generate-action";

/**
 * Precomputes what the Topic Detail page's <GenerateAction> needs to
 * render: the resolved default model for a task (or the reason there
 * isn't one) plus the full override-candidate list — without running
 * anything. Server-only, called from the (server component) page.
 */
export async function getTaskModelOptions(taskType: TaskType): Promise<{
  defaultModel: OverridableModel | null;
  resolutionError: string | null;
  models: OverridableModel[];
}> {
  const resolution = await resolveModelForTask(taskType, null);
  const models = listModelsForTask(taskType).map((m) => ({
    provider: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    pricingType: m.pricingType,
    configured: isProviderConfigured(m.provider),
  }));

  if (!resolution.ok) {
    return { defaultModel: null, resolutionError: resolution.error, models };
  }

  const { model } = resolution;
  return {
    defaultModel: {
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName,
      pricingType: model.pricingType,
      configured: isProviderConfigured(model.provider),
    },
    resolutionError: null,
    models,
  };
}
