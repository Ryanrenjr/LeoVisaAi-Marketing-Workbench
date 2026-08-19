-- LeoVisaAi 营销工作台 — Research Agent hardening + full Phase 1 status model
-- See docs/phase-3-5-plan.md before changing this file.

-- ---------------------------------------------------------------------
-- Full Phase 1 status model. Only IDEA→RESEARCHING, RESEARCHING⇄
-- RESEARCH_READY, RESEARCH_READY→RESEARCH_APPROVED, and *→ARCHIVED are
-- wired to real actions. CONTENT_DRAFT / COMPLIANCE_REVIEW / LEO_REVIEW /
-- APPROVED are added now so the model is complete, but nothing
-- transitions into them yet — that's the Content AI milestone.
-- ---------------------------------------------------------------------

alter type public.topic_status add value 'RESEARCH_READY' after 'RESEARCHING';
alter type public.topic_status add value 'CONTENT_DRAFT' after 'RESEARCH_APPROVED';
alter type public.topic_status add value 'COMPLIANCE_REVIEW' after 'CONTENT_DRAFT';
alter type public.topic_status add value 'LEO_REVIEW' after 'COMPLIANCE_REVIEW';
alter type public.topic_status add value 'APPROVED' after 'LEO_REVIEW';

-- ---------------------------------------------------------------------
-- Research pack self-reported confidence. Defaults to LOW — a missing or
-- unreadable confidence claim from the model is never silently treated as
-- trustworthy. See src/lib/ai/research-pack.ts "LOW-confidence handling".
-- ---------------------------------------------------------------------

create type public.research_confidence as enum ('LOW', 'MEDIUM', 'HIGH');

alter table public.research_packs
  add column confidence public.research_confidence not null default 'LOW';

-- Source freshness, as reported by the web_search tool on the actual
-- result (never claimed by the model itself) — lets a reviewer judge how
-- current a source is.
alter table public.research_sources
  add column page_age text;
