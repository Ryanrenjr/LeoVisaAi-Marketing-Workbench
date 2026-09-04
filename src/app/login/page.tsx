"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-lg font-semibold">LeoVisaAi 营销工作台</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          访问密码
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5"
          />
        </label>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </Button>
      </form>
    </main>
  );
}
