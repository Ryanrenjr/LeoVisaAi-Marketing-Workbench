import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  RESEARCH_SYSTEM_PROMPT,
  buildGroundedPack,
  buildResearchUserPrompt,
  parseResearchPackJson,
  type GroundedResearchPack,
  type RealSearchResult,
} from "./research-pack";
import { appendCustomInstructions } from "./prompt-addendum";

const MODEL_ALIAS = process.env.RESEARCH_MODEL || "claude-opus-5";
const MAX_SEARCH_USES = 6;
const MAX_PAUSE_RESUMES = 4;

export interface ResearchAgentSuccess {
  ok: true;
  pack: GroundedResearchPack;
  modelAlias: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface ResearchAgentFailure {
  ok: false;
  error: string;
  modelAlias: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export type ResearchAgentResult = ResearchAgentSuccess | ResearchAgentFailure;

function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function isResearchAgentConfigured(): boolean {
  return isConfigured();
}

export function researchAgentModelAlias(): string {
  return MODEL_ALIAS;
}

/**
 * Runs the Research Agent for a topic: real web search via Anthropic's
 * server-side web_search tool, then a grounded (anti-hallucination
 * filtered) research pack. See src/lib/ai/research-pack.ts for the
 * parsing/grounding logic this wraps.
 */
export async function runResearchAgent(
  topic: {
    title: string;
    question: string;
    business: string;
    audience: string;
  },
  customInstructions?: string | null,
): Promise<ResearchAgentResult> {
  const started = Date.now();

  if (!isConfigured()) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY 未配置，无法运行研究。",
      modelAlias: MODEL_ALIAS,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - started,
    };
  }

  const client = new Anthropic();

  try {
    let messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildResearchUserPrompt(topic) },
    ];
    let finalMessage: Anthropic.Message | null = null;

    for (let i = 0; i < MAX_PAUSE_RESUMES; i++) {
      const stream = client.messages.stream({
        model: MODEL_ALIAS,
        max_tokens: 16000,
        system: appendCustomInstructions(RESEARCH_SYSTEM_PROMPT, customInstructions),
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCH_USES }],
        messages,
      });
      const message = await stream.finalMessage();

      if (message.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: message.content }];
        continue;
      }
      finalMessage = message;
      break;
    }

    if (!finalMessage) {
      throw new Error("研究未能在多次续跑后完成（pause_turn 次数过多）。");
    }

    const latencyMs = Date.now() - started;
    const usage = finalMessage.usage;

    const realResults: RealSearchResult[] = [];
    for (const block of finalMessage.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result.type === "web_search_result") {
            realResults.push({ title: result.title, url: result.url, pageAge: result.page_age });
          }
        }
      }
    }

    const textBlock = finalMessage.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("模型没有返回最终文本结果。");
    }

    const claim = parseResearchPackJson(textBlock.text);
    const pack = buildGroundedPack(claim, realResults);

    return {
      ok: true,
      pack,
      modelAlias: MODEL_ALIAS,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message =
      err instanceof Anthropic.APIError
        ? `Anthropic API 错误 (${err.status}): ${err.message}`
        : err instanceof Error
          ? err.message
          : "未知错误";
    return {
      ok: false,
      error: message,
      modelAlias: MODEL_ALIAS,
      inputTokens: null,
      outputTokens: null,
      latencyMs,
    };
  }
}
