import { getModel, isModelSuitableForTask, listModelsForTask } from "./providers/registry";
import type { ModelRef, ModelRegistryEntry, TaskType } from "./providers/types";

/**
 * Pure model-selection logic for the Model Router — no Supabase, no env
 * reads beyond the boolean passed in, so it's directly unit-testable. The
 * async orchestration (fetching AI_DEVELOPMENT_MODE and the ADMIN-configured
 * default from the database) lives in router.ts.
 *
 * Precedence, matching the product rule "a digital employee is not
 * permanently tied to one model": an explicit one-off override always
 * wins, then ADMIN's persisted default for the task, then — only in
 * Development Mode — the first enabled, development-recommended, FREE
 * model that satisfies the task's capability requirement. There is no
 * automatic FREE → PAID fallback anywhere in this function.
 */

export interface SelectModelParams {
  taskType: TaskType;
  developmentMode: boolean;
  configuredDefault: ModelRef | null;
  executionOverride: ModelRef | null;
}

export type SelectModelSource = "override" | "configured_default" | "development_free_first";

export type SelectModelResult =
  | { ok: true; model: ModelRegistryEntry; source: SelectModelSource }
  | { ok: false; error: string };

/**
 * RESEARCH has no special-cased message: it only requires structured
 * output now (the Search Router path never calls the model's own search
 * tool — see isModelSuitableForTask in registry.ts), same requirement as
 * every other task, so the generic message is already accurate.
 */
function capabilityError(): string {
  return "此模型不支持当前任务所需的结构化输出能力。";
}

export function selectModel(params: SelectModelParams): SelectModelResult {
  const { taskType, developmentMode, configuredDefault, executionOverride } = params;

  if (executionOverride) {
    const model = getModel(executionOverride.provider, executionOverride.modelId);
    if (!model) return { ok: false, error: "所选模型不存在或已停用。" };
    if (!isModelSuitableForTask(model, taskType)) return { ok: false, error: capabilityError() };
    return { ok: true, model, source: "override" };
  }

  if (configuredDefault) {
    const model = getModel(configuredDefault.provider, configuredDefault.modelId);
    if (model && isModelSuitableForTask(model, taskType)) {
      return { ok: true, model, source: "configured_default" };
    }
    if (!developmentMode) {
      return { ok: false, error: "已配置的默认模型当前不可用，请在「AI 模型配置」中重新选择。" };
    }
    // Configured default is stale/invalid — in Development Mode, fall
    // through to the free-first search below rather than hard-failing.
  }

  if (developmentMode) {
    const candidates = listModelsForTask(taskType).filter(
      (m) => m.developmentRecommended && m.pricingType === "FREE",
    );
    if (candidates.length > 0) return { ok: true, model: candidates[0], source: "development_free_first" };
    return { ok: false, error: "免费模型当前不可用，请选择其他模型。" };
  }

  return { ok: false, error: "尚未为该任务配置默认模型，请在「AI 模型配置」中设置。" };
}

/** Whether the UI must show the "this may incur cost" confirmation before running this model. */
export function requiresPaidWarning(model: Pick<ModelRegistryEntry, "pricingType">): boolean {
  return model.pricingType === "PAID" || model.pricingType === "MIXED";
}
