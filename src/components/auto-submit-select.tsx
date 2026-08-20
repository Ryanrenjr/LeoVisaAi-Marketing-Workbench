"use client";

import { useRef } from "react";

/**
 * A <select> that saves itself the moment you change it — no separate
 * "保存" click. Used wherever a choice is genuinely just "pick one
 * option," which is most of what's left on the admin pages. See
 * CLAUDE.md "UI must remain minimal" / the "一键" (one-click) ask.
 */
export function AutoSubmitSelect({
  action,
  hiddenFields,
  name,
  defaultValue,
  options,
  disabled = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action}>
      {Object.entries(hiddenFields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <select
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-md border border-[var(--border)] bg-transparent px-2 py-1 text-sm disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </form>
  );
}
