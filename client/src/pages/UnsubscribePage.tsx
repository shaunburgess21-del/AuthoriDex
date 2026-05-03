import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Status = "pending" | "success" | "error";

export default function UnsubscribePage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("pending");
  const [message, setMessage] = useState("Processing your unsubscribe request...");

  useEffect(() => {
    const controller = new AbortController();
    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      setStatus("error");
      setMessage("This unsubscribe link is missing a token.");
      return () => controller.abort();
    }

    void (async () => {
      try {
        const response = await fetch(
          `/api/email/unsubscribe?token=${encodeURIComponent(token)}`,
          {
            method: "GET",
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          setStatus("error");
          setMessage("This unsubscribe link is invalid or expired.");
          return;
        }

        setStatus("success");
        setMessage("You have been unsubscribed from marketing emails.");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
        setMessage("We could not process your request right now. Please try again.");
      }
    })();

    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            {status === "pending"
              ? "Unsubscribing..."
              : status === "success"
                ? "You're unsubscribed"
                : "Unsubscribe failed"}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={() => setLocation("/")} data-testid="button-unsubscribe-home">
            Go home
          </Button>
          {status === "error" ? (
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              data-testid="button-unsubscribe-retry"
            >
              Retry
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
