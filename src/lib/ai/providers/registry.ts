import type { AIProviderId, ModelRegistryEntry, TaskType } from "./types";

/**
 * The single source of truth for model metadata. Do not scatter model
 * names/ids anywhere else in the codebase — always look them up here.
 *
 * Pricing changes frequently; entries are qualitative ("免费层" /
 * "可能产生费用" / "付费") plus `lastVerifiedAt`, never a hard-coded USD
 * price shown in Boss Mode. See docs/model-router.md "Pricing".
 */
export const MODEL_REGISTRY: readonly ModelRegistryEntry[] = [
  // --- Anthropic ---------------------------------------------------------
  {
    provider: "ANTHROPIC",
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    pricingType: "PAID",
    supportsWebSearch: true,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    enabled: true,
    // Not the automatic development default — retained for manual use.
    developmentRecommended: false,
    dataPolicyNote: "通过 Anthropic API 调用，不用于训练模型（Anthropic 商业条款）。",
    freeTierNote: null,
    pricingNote: "按输入/输出 token 计费，价格以 Anthropic 官方定价为准。",
    lastVerifiedAt: "2026-08-20",
  },

  // --- Google Gemini -------------------------------------------------------
  // gemini-2.5-flash / gemini-2.5-flash-lite (registered in the original
  // Model Router milestone) still appear in the models.list endpoint but
  // real generateContent calls fail for new API keys/projects with 404
  // "no longer available to new users" — confirmed live on 2026-08-20 via
  // a real request with this app's own key. Google's own error names the
  // replacement. Confirmed working (structured output) via a real call on
  // 2026-08-20: gemini-3.6-flash, gemini-3.5-flash-lite. See
  // docs/provider-smoke-test.md — note Google Search grounding hit a
  // 429 RESOURCE_EXHAUSTED quota error on this free-tier key even before
  // any Research Agent run; grounding may need its own quota headroom.
  {
    provider: "GOOGLE",
    modelId: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    pricingType: "FREE",
    supportsWebSearch: true,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    enabled: true,
    developmentRecommended: true,
    dataPolicyNote: "通过 Google AI Studio 免费层调用；免费层的输入输出可能被 Google 用于改进产品，请勿用于真实客户敏感信息。",
    freeTierNote: "Google AI Studio 免费层，按分钟/按天有速率限制；googleSearch 联网检索的免费配额比普通生成更紧张，已实测触发 429。",
    pricingNote: "超出免费额度或改用计费项目（Vertex AI）时可能产生费用。",
    lastVerifiedAt: "2026-08-20",
  },
  {
    provider: "GOOGLE",
    modelId: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    pricingType: "FREE",
    supportsWebSearch: true,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsReasoning: false,
    enabled: true,
    developmentRecommended: true,
    dataPolicyNote: "通过 Google AI Studio 免费层调用；免费层的输入输出可能被 Google 用于改进产品，请勿用于真实客户敏感信息。",
    freeTierNote: "Google AI Studio 免费层，速率限制比 Flash 更宽松，能力更轻量。",
    pricingNote: "超出免费额度或改用计费项目（Vertex AI）时可能产生费用。官方已宣布该模型将于 2026-10-16 停用，届时需更新此处的 modelId。",
    lastVerifiedAt: "2026-08-20",
  },

  // --- Groq ----------------------------------------------------------------
  // llama-3.3-70b-versatile and qwen/qwen3-32b (registered in the original
  // Model Router milestone) were deprecated by Groq on 2026-06-17 with a
  // shutdown date of 2026-08-16 — already past as of this verification
  // (2026-08-20). Replaced with Groq's own documented migration targets,
  // confirmed current via console.groq.com/docs/models on 2026-08-20. See
  // docs/provider-smoke-test.md.
  {
    provider: "GROQ",
    modelId: "openai/gpt-oss-120b",
    displayName: "GPT-OSS 120B (Groq)",
    pricingType: "FREE",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    enabled: true,
    developmentRecommended: true,
    dataPolicyNote: "通过 Groq 免费层调用，不具备联网检索能力。",
    freeTierNote: "Groq 免费层，按请求数/token 数有速率限制。",
    pricingNote: "超出免费额度时可能产生费用，具体以 Groq 官方定价为准。",
    lastVerifiedAt: "2026-08-20",
  },
  {
    provider: "GROQ",
    modelId: "openai/gpt-oss-20b",
    displayName: "GPT-OSS 20B (Groq)",
    pricingType: "FREE",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    enabled: true,
    developmentRecommended: true,
    dataPolicyNote: "通过 Groq 免费层调用，不具备联网检索能力。",
    freeTierNote: "Groq 免费层，按请求数/token 数有速率限制，比 120B 更快更轻量。",
    pricingNote: "超出免费额度时可能产生费用，具体以 Groq 官方定价为准。",
    lastVerifiedAt: "2026-08-20",
  },

  // --- OpenRouter ------------------------------------------------------------
  // Experimental / A-B testing surface — free-model slugs on OpenRouter
  // rotate; verify against OpenRouter's current model list before relying
  // on these for anything beyond manual experimentation.
  {
    provider: "OPENROUTER",
    modelId: "meta-llama/llama-3.3-70b-instruct:free",
    displayName: "Llama 3.3 70B (OpenRouter · Free)",
    pricingType: "FREE",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: false,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenRouter 转发调用第三方模型；请求已配置拒绝会记录/训练数据的供应商，但请以 OpenRouter 当前政策为准。",
    freeTierNote: "OpenRouter 免费模型（:free），有较严格的速率限制，供应商可用性会变化。",
    pricingNote: "免费额度用尽或该免费模型下线时会调用失败，不会自动切换为付费模型。",
    lastVerifiedAt: "2026-08-20",
  },
  {
    provider: "OPENROUTER",
    modelId: "google/gemini-2.0-flash-exp:free",
    displayName: "Gemini 2.0 Flash Exp (OpenRouter · Free)",
    pricingType: "FREE",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: false,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsReasoning: false,
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenRouter 转发调用第三方模型；请求已配置拒绝会记录/训练数据的供应商，但请以 OpenRouter 当前政策为准。",
    freeTierNote: "OpenRouter 免费模型（:free），有较严格的速率限制，供应商可用性会变化。",
    pricingNote: "免费额度用尽或该免费模型下线时会调用失败，不会自动切换为付费模型。",
    lastVerifiedAt: "2026-08-20",
  },

  // --- OpenAI ----------------------------------------------------------------
  // Real calls via raw HTTP (Chat Completions, JSON mode) — no native
  // web-search or vision path wired yet, so no OpenAI entry can satisfy
  // PERFORMANCE_ANALYSIS (needs supportsVision). RESEARCH is different: an
  // OpenAI model CAN be selected for RESEARCH, but only for the Search
  // Router path (Search Provider retrieves real sources first, model only
  // analyses them via structured output — see runResearchTask in
  // router.ts) — never the native-grounding fallback, which is gated
  // separately and explicitly to ANTHROPIC/GOOGLE only regardless of this
  // registry (see runNativeResearchTask). isModelSuitableForTask's RESEARCH
  // check is therefore just supportsStructuredOutput, same as every other
  // task, not supportsWebSearch — see registry.ts below. OpenAI has no
  // free tier, so every entry here is PAID and NOT developmentRecommended
  // — Development Mode's free-first routing will never auto-select one; an
  // ADMIN must explicitly set one as the default in /admin/ai-models.
  // gpt-5-mini confirmed working end-to-end via a real chat completions
  // call (JSON mode) on 2026-08-21; gpt-5 confirmed present in this
  // account's /v1/models listing the same day but not separately
  // smoke-tested.
  {
    provider: "OPENAI",
    modelId: "gpt-5-mini",
    displayName: "GPT-5 mini (OpenAI)",
    pricingType: "PAID",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenAI API 直接调用；按 OpenAI API 数据使用政策，API 数据默认不用于训练模型。",
    freeTierNote: null,
    pricingNote: "按输入/输出 token 计费，需要在你的 OpenAI 账户绑定付款方式并保有余额，价格以 OpenAI 官方定价为准。",
    lastVerifiedAt: "2026-08-21",
  },
  // gpt-5.6-terra — the balanced tier of OpenAI's GPT-5.6 series (between
  // the flagship Sol and cost-efficient Luna), supports vision/tool
  // use/structured outputs/reasoning via both Chat Completions and
  // Responses; this app calls it through Chat Completions like the rest of
  // the OpenAI entries above. Live user instruction: fixed as A｜选题策划员's
  // TOPIC_DISCOVERY model with reasoning_effort locked to "medium" (its own
  // documented default) — "性价比最好" for 搜新闻/找角度/判断传播/排序. See
  // reasoningEffort below and generateOpenAIStructured in openai-provider.ts
  // for how that gets sent on the request.
  {
    provider: "OPENAI",
    modelId: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra (OpenAI)",
    pricingType: "PAID",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    reasoningEffort: "medium",
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenAI API 直接调用；按 OpenAI API 数据使用政策，API 数据默认不用于训练模型。",
    freeTierNote: null,
    pricingNote: "按输入/输出 token 计费（含独立的缓存读写价格），需要在你的 OpenAI 账户绑定付款方式并保有余额，价格以 OpenAI 官方定价为准。",
    lastVerifiedAt: "2026-08-27",
  },
  // gpt-5.6-sol — the flagship tier of OpenAI's GPT-5.6 series (above
  // Terra and Luna), strongest reasoning/coding/agentic performance in the
  // family. Live user instruction: fixed as B｜政策研究员's RESEARCH model
  // with reasoning_effort locked to "high" — B's job (查清事实、判断规则、
  // 六项打分、二次复审) is exactly the kind of careful, multi-step
  // reasoning task worth paying for the flagship tier, unlike A's
  // higher-volume/lower-stakes topic triage on Terra/medium.
  {
    provider: "OPENAI",
    modelId: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol (OpenAI)",
    pricingType: "PAID",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsReasoning: true,
    reasoningEffort: "high",
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenAI API 直接调用；按 OpenAI API 数据使用政策，API 数据默认不用于训练模型。",
    freeTierNote: null,
    pricingNote: "按输入/输出 token 计费（含独立的缓存读写价格），比 Terra 更贵，需要在你的 OpenAI 账户绑定付款方式并保有余额，价格以 OpenAI 官方定价为准。",
    lastVerifiedAt: "2026-08-27",
  },
  {
    provider: "OPENAI",
    modelId: "gpt-5",
    displayName: "GPT-5 (OpenAI)",
    pricingType: "PAID",
    supportsWebSearch: false,
    supportsStructuredOutput: true,
    supportsToolUse: true,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsReasoning: true,
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenAI API 直接调用；按 OpenAI API 数据使用政策，API 数据默认不用于训练模型。",
    freeTierNote: null,
    pricingNote: "按输入/输出 token 计费，比 mini 版更贵，需要在你的 OpenAI 账户绑定付款方式并保有余额，价格以 OpenAI 官方定价为准。",
    lastVerifiedAt: "2026-08-21",
  },
  // Image generation (Images API, not Chat Completions) — the ONLY entry
  // with supportsImageGeneration: true. Deliberately supportsStructuredOutput:
  // false: it is a different endpoint shape entirely and must never be
  // selected for a text task. See openai-provider.ts generateOpenAIImage.
  // gpt-image-1 (the original release) was superseded by gpt-image-1.5 /
  // gpt-image-2 in this account's /v1/models listing by 2026-08-21 — this
  // registers gpt-image-2 (dated 2026-04-21, the newest non-preview entry)
  // and confirmed working end-to-end via a real /v1/images/generations
  // call the same day. Re-verify against platform.openai.com/docs/models
  // if OpenAI ships a newer generation later.
  {
    provider: "OPENAI",
    modelId: "gpt-image-2",
    displayName: "GPT Image 2 (OpenAI)",
    pricingType: "PAID",
    supportsWebSearch: false,
    supportsStructuredOutput: false,
    supportsToolUse: false,
    supportsVision: false,
    supportsImageGeneration: true,
    supportsReasoning: false,
    enabled: true,
    developmentRecommended: false,
    dataPolicyNote: "通过 OpenAI API 直接调用；按 OpenAI API 数据使用政策，API 数据默认不用于训练模型。",
    freeTierNote: null,
    pricingNote: "按生成图片的尺寸/质量计费，需要在你的 OpenAI 账户绑定付款方式并保有余额，价格以 OpenAI 官方定价为准。",
    lastVerifiedAt: "2026-08-21",
  },
] as const;

export function getModel(provider: AIProviderId, modelId: string): ModelRegistryEntry | null {
  return MODEL_REGISTRY.find((m) => m.provider === provider && m.modelId === modelId) ?? null;
}

export function listModels(): readonly ModelRegistryEntry[] {
  return MODEL_REGISTRY;
}

/**
 * PERFORMANCE_ANALYSIS requires reading a screenshot (vision);
 * IMAGE_GENERATION requires the Images endpoint capability; every other
 * task — including RESEARCH — only requires structured output.
 *
 * RESEARCH doesn't require `supportsWebSearch` here: the live path
 * (Search Router retrieves real sources, then the resolved model only
 * analyses them via structured output — see runResearchTask in router.ts)
 * never calls the model's own search tool. `supportsWebSearch` still
 * matters for the native-grounding fallback (no search provider
 * configured), but that path is gated separately and explicitly to
 * ANTHROPIC/GOOGLE regardless of this function (see
 * runNativeResearchTask) — a model that reaches that path without real
 * search ability fails there with a clear error, it doesn't silently
 * proceed.
 */
export function isModelSuitableForTask(model: ModelRegistryEntry, taskType: TaskType): boolean {
  if (!model.enabled) return false;
  if (taskType === "PERFORMANCE_ANALYSIS") return model.supportsVision && model.supportsStructuredOutput;
  if (taskType === "IMAGE_GENERATION") return model.supportsImageGeneration;
  return model.supportsStructuredOutput;
}

export function listModelsForTask(taskType: TaskType): readonly ModelRegistryEntry[] {
  return MODEL_REGISTRY.filter((m) => isModelSuitableForTask(m, taskType));
}

const PROVIDER_ENV_VAR: Record<AIProviderId, string> = {
  ANTHROPIC: "ANTHROPIC_API_KEY",
  GOOGLE: "GOOGLE_AI_API_KEY",
  GROQ: "GROQ_API_KEY",
  OPENROUTER: "OPENROUTER_API_KEY",
  OPENAI: "OPENAI_API_KEY",
};

export function isProviderConfigured(provider: AIProviderId): boolean {
  return Boolean(process.env[PROVIDER_ENV_VAR[provider]]);
}

export function providerEnvVarName(provider: AIProviderId): string {
  return PROVIDER_ENV_VAR[provider];
}
