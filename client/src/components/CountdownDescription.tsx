import { useEffect, useState } from "react";

/**
 * Sonner toast description with a live ticking "Try again in Xs…" counter.
 *
 * The legacy shadcn toaster had a CountdownTimer baked into the toaster
 * wrapper; Sonner has no equivalent, so we ship the timer as a JSX
 * description instead. Pass `text` for the headline reason and `seconds`
 * for the retry-after window — the component simply stops ticking at 0
 * and renders nothing more (Sonner's own duration handles dismissal).
 */
export function CountdownDescription({
  seconds,
  text,
}: {
  seconds: number;
  text: string;
}) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.floor(seconds)));

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  return (
    <div className="space-y-1">
      <p>{text}</p>
      {remaining > 0 ? (
        <p className="text-xs opacity-75 tabular-nums">
          Try again in {remaining}s…
        </p>
      ) : null}
    </div>
  );
}

export default CountdownDescription;
