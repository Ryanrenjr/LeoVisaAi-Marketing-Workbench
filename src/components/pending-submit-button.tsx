"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui/button";
import type { ButtonHTMLAttributes } from "react";

/**
 * A plain `<form action={...}>` submit button gives zero feedback between
 * the click and the page actually navigating away — live user instruction
 * ("整体UI再做的更加交互一点") flagged this as the most noticeable "nothing
 * happened" moment (研究页面的 淘汰/通过 按钮). `useFormStatus` reads the
 * pending state of the nearest ancestor <form> without needing to convert
 * the whole page into a Client Component — just this button.
 */
export function PendingSubmitButton({
  children,
  pendingLabel = "处理中…",
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} className={className} disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
