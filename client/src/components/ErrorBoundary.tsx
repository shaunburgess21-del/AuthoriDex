import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { boundaryRecovery, isChunkLoadError } from "@/lib/chunkReload";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
    if (typeof window === "undefined") return;
    const action = boundaryRecovery(error, window.sessionStorage, () => {
      window.location.reload();
    });
    if (action === "reload") {
      console.warn("[ErrorBoundary] Chunk load failed, reloading once:", error);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
            <h2 className="text-xl font-semibold text-foreground">This page didn't load</h2>
            <p className="max-w-md text-muted-foreground">Refresh to try again.</p>
            <Button onClick={() => window.location.reload()}>Refresh</Button>
          </div>
        );
      }

      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
          <p className="max-w-md text-muted-foreground">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
