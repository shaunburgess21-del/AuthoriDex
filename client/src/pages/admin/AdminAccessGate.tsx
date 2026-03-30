import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ReactNode } from "react";

type ProfileShape = { role?: string | null } | null;

export interface AdminAccessBlockProps {
  profileLoading: boolean;
  user: unknown;
  profile: ProfileShape;
  isAdmin: boolean;
  onGoHome: () => void;
}

/**
 * If this returns non-null, AdminDashboard should return it immediately.
 * If null, render the main admin UI.
 */
export function getAdminAccessBlock({
  profileLoading,
  user,
  profile,
  isAdmin,
  onGoHome,
}: AdminAccessBlockProps): ReactNode | null {
  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Checking admin access...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign In Required</h2>
          <p className="text-muted-foreground mb-4">Please sign in to access the admin panel.</p>
          <Button onClick={onGoHome} data-testid="button-go-home">
            Go to Homepage
          </Button>
        </Card>
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    const showRoleDebug = import.meta.env.DEV;
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">You do not have permission to access the admin panel.</p>
          {showRoleDebug && (
            <p className="text-xs text-muted-foreground mb-4">
              Debug: Role = &quot;{profile?.role ?? ""}&quot; | Expected = &quot;admin&quot;
            </p>
          )}
          <Button onClick={onGoHome} data-testid="button-go-home">
            Go to Homepage
          </Button>
        </Card>
      </div>
    );
  }

  return null;
}
