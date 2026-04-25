import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut } from "lucide-react";
import { toast } from "sonner";

export function UserAvatar() {
  const { user, profile, signOut } = useAuth();
  const [, setLocation] = useLocation();

  if (!user) return null;

  const displayName = user.user_metadata?.full_name || user.email || "";

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out", {
        description: "You've been successfully signed out.",
      });
      setLocation("/");
    } catch (error) {
      toast.error("Error", {
        description: "Failed to sign out. Please try again.",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-md hover-elevate active-elevate-2 overflow-visible"
          data-testid="button-user-avatar"
        >
          <UserProfileAvatar
            displayName={displayName}
            avatarUrl={profile?.avatarUrl}
            size="sm"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {user.user_metadata?.full_name || "User"}
            </span>
            <span className="text-xs text-muted-foreground truncate">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setLocation("/profile")}
          data-testid="menu-item-profile"
        >
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} data-testid="menu-item-logout">
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
