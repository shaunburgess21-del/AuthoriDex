import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Password field with a show/hide toggle button on the right edge.
 *
 * Wraps the shared <Input> so styling stays in lockstep with the rest of the
 * form library. The visibility state is local to the component — each instance
 * is independently togglable, so a user can show their new password while
 * keeping the confirm field hidden (or vice versa).
 *
 * Pass-through: every native <input> prop (value, onChange, autoComplete,
 * minLength, placeholder, name, id, data-testid, aria-*) is forwarded. The
 * `type` prop is owned by this component and ignored if provided.
 */
export type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, disabled, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    // Derive a unique test-id and aria-controls target from the input id when
    // available, so multiple password fields on the same page (e.g. new +
    // confirm) get distinct hooks for tests and screen readers.
    const inputId = typeof props.id === "string" ? props.id : undefined;
    const toggleTestId = inputId
      ? `button-toggle-${inputId}-visibility`
      : "button-toggle-password-visibility";

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          disabled={disabled}
          // pr-10 to leave room for the toggle button without overlapping text.
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={inputId}
          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={toggleTestId}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
