"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { EmployeeId } from "@/lib/boss-language";

/** Caps below 100% — this is a "still working" estimate, not real task progress, so it must never claim to be done before the real result actually arrives. */
const MAX_DISPLAY_PERCENT = 95;

/**
 * "该员工正在思考" state — avatar with a gentle breathing pulse + name +
 * a percentage, shown in place of the action button while its AI call is
 * in flight. There's no real progress signal from a single request/
 * response AI call, so the percentage is a decelerating estimate (fast at
 * first, slows down, never reaches 100 — the row itself unmounts the
 * moment the real result is ready). Live user instruction: "AI在思考过程
 *中要有显示，就显示那个员工在思考" + "所有的工作过程思考的时候加一个百分比".
 */
export function ThinkingRow({ avatarId, name }: { avatarId: EmployeeId; name: string }) {
  const [percent, setPercent] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setPercent((prev) => {
        if (prev >= MAX_DISPLAY_PERCENT) return prev;
        return Math.min(MAX_DISPLAY_PERCENT, prev + Math.max(1, Math.round((MAX_DISPLAY_PERCENT - prev) * 0.15)));
      });
    }, 350);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Image
        src={`/employees/${avatarId}.png`}
        alt=""
        width={28}
        height={28}
        className="thinking-avatar h-7 w-7 shrink-0 rounded-full object-cover"
      />
      <span className="text-sm text-[var(--muted)]">
        {name} 正在思考… {percent}%
      </span>
    </div>
  );
}
