"use client";

import { useState } from "react";

export interface TabDef {
  key: string;
  label: string;
  content: React.ReactNode;
  disabled?: boolean;
}

export function TopicTabs({ tabs }: { tabs: TabDef[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            disabled={tab.disabled}
            onClick={() => setActive(tab.key)}
            className={`px-3 py-2 text-sm ${
              active === tab.key
                ? "border-b-2 border-[var(--accent)] font-medium"
                : "border-b-2 border-transparent text-[var(--muted)]"
            } ${tab.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-[var(--foreground)]"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{activeTab?.content}</div>
    </div>
  );
}
