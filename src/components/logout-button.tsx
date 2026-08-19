import { logout } from "@/app/login/actions";
import { Button } from "./ui/button";

export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="secondary" className="text-xs">
        退出登录
      </Button>
    </form>
  );
}
