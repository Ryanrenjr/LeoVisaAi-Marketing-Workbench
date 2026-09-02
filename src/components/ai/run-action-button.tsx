"use client";

import { useTransition } from "react";
import { Button } from "../ui/button";
import { ThinkingRow } from "./thinking-row";
import type { EmployeeId } from "@/lib/boss-language";

/**
 * "点了没反应，也没有百分比" (live user bug report) — a handful of buttons
 * on the Topic Detail page (运行研究 chief among them) are plain
 * `<form action>` submits with no picker/PAID-warning machinery to earn
 * (unlike `GenerateAction`, which those buttons deliberately skip — B's
 * research model is fixed, no override), so they had literally no
 * feedback while the AI call was in flight: the button just sat there
 * until the whole page re-rendered. This is the minimal fix — swap the
 * plain form for a click handler wrapped in `useTransition`, show
 * `ThinkingRow` (same "正在思考…N%" pattern every other AI button already
 * uses) while pending.
 */
export function RunActionButton({
  action,
  label,
  employeeId,
  employeeName,
  variant = "primary",
}: {
  action: () => Promise<void>;
  label: string;
  employeeId: EmployeeId;
  employeeName: string;
  variant?: "primary" | "secondary";
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await action();
    });
  }

  if (pending) return <ThinkingRow avatarId={employeeId} name={employeeName} />;

  return (
    <Button type="button" variant={variant} onClick={handleClick}>
      {label}
    </Button>
  );
}
