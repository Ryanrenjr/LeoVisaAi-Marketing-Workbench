import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import {
  DEMO_ACTIVITY,
  DEMO_AI_USAGE_LOG,
  DEMO_CONTENT_ASSETS,
  DEMO_PROFILES,
  DEMO_RESEARCH_PACKS,
  DEMO_RESEARCH_SOURCES,
  DEMO_STATUS_EVENTS,
  DEMO_TOPICS,
} from "./demo-data";
import { startOfCurrentWeek } from "./status";
import type {
  AiUsageLogEntry,
  ContentAsset,
  Profile,
  ResearchPack,
  ResearchSource,
  Topic,
  TopicActivity,
  TopicStatus,
  TopicStatusEvent,
} from "./types";

/** True when the app is falling back to static demo content this request. */
export async function isDemoMode(): Promise<boolean> {
  return !isSupabaseConfigured();
}

export async function getTopicsByStatus(status: TopicStatus): Promise<Topic[]> {
  if (!isSupabaseConfigured()) {
    return DEMO_TOPICS.filter((topic) => topic.status === status);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: true });

  if (error) {
    return DEMO_TOPICS.filter((topic) => topic.status === status);
  }
  return data;
}

const LIBRARY_STATUSES: TopicStatus[] = ["IDEA", "RESEARCHING", "RESEARCH_READY"];

/** All topics in the active topic-library stages (IDEA, RESEARCHING, RESEARCH_READY), most recent first. */
export async function getLibraryTopics(): Promise<Topic[]> {
  if (!isSupabaseConfigured()) {
    return DEMO_TOPICS.filter((topic) => LIBRARY_STATUSES.includes(topic.status));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .in("status", LIBRARY_STATUSES)
    .order("created_at", { ascending: false });

  if (error) {
    return DEMO_TOPICS.filter((topic) => LIBRARY_STATUSES.includes(topic.status));
  }
  return data;
}

export async function getTopicById(id: string): Promise<Topic | null> {
  if (!isSupabaseConfigured()) {
    return DEMO_TOPICS.find((topic) => topic.id === id) ?? null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("topics").select("*").eq("id", id).single();
  if (error) return null;
  return data;
}

export async function getTopicActivity(topicId: string): Promise<TopicActivity[]> {
  if (!isSupabaseConfigured()) {
    return DEMO_ACTIVITY.filter((event) => event.topic_id === topicId);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topic_activity_log")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

export async function getPublishedThisWeek(): Promise<Topic[]> {
  const weekStart = startOfCurrentWeek().toISOString();

  if (!isSupabaseConfigured()) {
    return DEMO_TOPICS.filter(
      (topic) => topic.status === "PUBLISHED" && (topic.published_at ?? "") >= weekStart,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .eq("status", "PUBLISHED")
    .gte("published_at", weekStart)
    .order("published_at", { ascending: false });

  if (error) {
    return DEMO_TOPICS.filter(
      (topic) => topic.status === "PUBLISHED" && (topic.published_at ?? "") >= weekStart,
    );
  }
  return data;
}

export async function getStageCounts(): Promise<Record<TopicStatus, number>> {
  const empty: Record<TopicStatus, number> = {
    IDEA: 0,
    RESEARCHING: 0,
    RESEARCH_READY: 0,
    RESEARCH_APPROVED: 0,
    CONTENT_DRAFT: 0,
    COMPLIANCE_REVIEW: 0,
    LEO_REVIEW: 0,
    APPROVED: 0,
    READY_TO_SHOOT: 0,
    PUBLISHED: 0,
    ARCHIVED: 0,
  };

  if (!isSupabaseConfigured()) {
    for (const topic of DEMO_TOPICS) empty[topic.status] += 1;
    return empty;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("topics").select("status");
  if (error || !data) {
    for (const topic of DEMO_TOPICS) empty[topic.status] += 1;
    return empty;
  }
  for (const row of data as { status: TopicStatus }[]) empty[row.status] += 1;
  return empty;
}

export async function getAllProfiles(): Promise<Profile[]> {
  if (!isSupabaseConfigured()) return DEMO_PROFILES;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return DEMO_PROFILES;
  return data;
}

export async function getRecentStatusEvents(limit = 20): Promise<TopicStatusEvent[]> {
  if (!isSupabaseConfigured()) return DEMO_STATUS_EVENTS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("topic_status_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return DEMO_STATUS_EVENTS;
  return data;
}

/** The most recent research pack for a topic (there may be several across re-runs), or null. */
export async function getLatestResearchPack(topicId: string): Promise<ResearchPack | null> {
  if (!isSupabaseConfigured()) {
    const packs = DEMO_RESEARCH_PACKS.filter((p) => p.topic_id === topicId);
    return packs.at(-1) ?? null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("research_packs")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

export async function getResearchSources(researchPackId: string): Promise<ResearchSource[]> {
  if (!isSupabaseConfigured()) {
    return DEMO_RESEARCH_SOURCES.filter((s) => s.research_pack_id === researchPackId);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("research_sources")
    .select("*")
    .eq("research_pack_id", researchPackId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data;
}

/**
 * Sources across several research packs in one query — used to resolve
 * every content asset's sources against its own research_pack_id (not
 * the topic's current pack). See src/lib/content-versions.ts
 * "groupSourcesByPackId".
 */
export async function getResearchSourcesForPacks(researchPackIds: string[]): Promise<ResearchSource[]> {
  if (researchPackIds.length === 0) return [];

  if (!isSupabaseConfigured()) {
    return DEMO_RESEARCH_SOURCES.filter((s) => researchPackIds.includes(s.research_pack_id));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("research_sources")
    .select("*")
    .in("research_pack_id", researchPackIds)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data;
}

export async function getRecentAiUsage(limit = 20): Promise<AiUsageLogEntry[]> {
  if (!isSupabaseConfigured()) return DEMO_AI_USAGE_LOG;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_usage_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return DEMO_AI_USAGE_LOG;
  return data;
}

/** Every content asset (every version, every platform) for a topic. Group with content-versions.ts. */
export async function getContentAssets(topicId: string): Promise<ContentAsset[]> {
  if (!isSupabaseConfigured()) {
    return DEMO_CONTENT_ASSETS.filter((a) => a.topic_id === topicId);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data;
}
