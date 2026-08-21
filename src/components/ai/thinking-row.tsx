import Image from "next/image";
import type { EmployeeId } from "@/lib/boss-language";

/**
 * "该员工正在思考" state — avatar with a gentle breathing pulse + name,
 * shown in place of the action button while its AI call is in flight.
 * Live user instruction: "AI在思考过程中要有显示，就显示那个员工在思考。"
 */
export function ThinkingRow({ avatarId, name }: { avatarId: EmployeeId; name: string }) {
  return (
    <div className="flex items-center gap-2">
      <Image
        src={`/employees/${avatarId}.png`}
        alt=""
        width={28}
        height={28}
        className="thinking-avatar h-7 w-7 shrink-0 rounded-full object-cover"
      />
      <span className="text-sm text-[var(--muted)]">{name} 正在思考…</span>
    </div>
  );
}
