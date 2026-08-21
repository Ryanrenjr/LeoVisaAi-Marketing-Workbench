import Image from "next/image";
import type { EmployeeId } from "@/lib/boss-language";

/**
 * Shared page-header identity block — avatar illustration + letter + name
 * — used at the top of every /team/* employee page. Mirrors
 * EmployeeCard's avatar treatment on the home page. See
 * docs/digital-employee-ux.md.
 */
export function EmployeeHeader({
  avatarId,
  letter,
  name,
  subtitle,
}: {
  avatarId: EmployeeId;
  letter: string;
  name: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Image
          src={`/employees/${avatarId}.png`}
          alt=""
          width={80}
          height={80}
          priority
          className="h-20 w-20 shrink-0 rounded-full object-cover"
        />
        <h1 className="text-xl font-semibold">
          <span className="mr-1.5 text-sm text-[var(--muted)]">{letter}</span>
          {name}
        </h1>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">{subtitle}</p>
    </div>
  );
}
