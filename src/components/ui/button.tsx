import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const base =
  "inline-flex items-center justify-center rounded-full px-4 py-1.5 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90",
  secondary:
    "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--border)]/40",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
