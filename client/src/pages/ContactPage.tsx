import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  contactSubmissionSchema,
  type ContactTopic,
} from "@shared/contact";

const MESSAGE_MAX = 4000;
const SUBJECT_MAX = 120;

type FieldErrors = Partial<
  Record<"name" | "email" | "topic" | "subject" | "message", string>
>;

/**
 * Public /contact route. Lives at /contact for both logged-in and
 * logged-out visitors — anyone might need to reach the team. Shares
 * the sticky-header + serif-h1 + pb-20 layout language used by
 * PricingPage and the rest of the app's top-level pages.
 *
 * Form posts to POST /api/contact, which validates against the
 * shared zod schema and emails team@voxdex.com via Resend with the
 * submitter's address as Reply-To.
 */
export default function ContactPage() {
  const [, setLocation] = useLocation();
  const { user, profile } = useAuth();

  // Same history-aware back pattern used elsewhere (PricingPage,
  // LegalDocumentPage, CheckoutPage). Falls back to home for direct
  // visits / shared links.
  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Go back"
              data-testid="button-contact-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link
              href="/"
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
              data-testid="link-contact-home"
            >
              <VoxDexLogo size={32} />
              <span className="font-serif text-xl font-bold">VoxDex</span>
            </Link>
          </div>
          <HeaderUserActions />
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 md:py-14">
        <ContactHero />
        <div className="mx-auto max-w-2xl">
          <ContactForm
            initialEmail={user?.email ?? ""}
            initialName={profile?.username ?? ""}
          />
        </div>
      </main>
    </div>
  );
}

function ContactHero() {
  return (
    <section className="mx-auto mb-10 max-w-3xl text-center md:mb-14">
      <h1
        className="mb-3 font-serif text-4xl font-bold tracking-tight md:text-5xl"
        data-testid="text-contact-title"
      >
        Get in touch
      </h1>
      <p className="text-base text-muted-foreground md:text-lg">
        Questions, feedback, bug reports, or just saying hi — pick a
        topic, drop us a note, and we'll reply soon.
      </p>
    </section>
  );
}

interface ContactFormProps {
  initialEmail: string;
  initialName: string;
}

function ContactForm({ initialEmail, initialName }: ContactFormProps) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [topic, setTopic] = useState<ContactTopic>("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot. Real users never see it; bots that fill every field
  // get filtered out server-side.
  const [website, setWebsite] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const messageRemaining = MESSAGE_MAX - message.length;
  const subjectRemaining = SUBJECT_MAX - subject.length;

  const topicOptions = useMemo(
    () =>
      CONTACT_TOPICS.map((id) => ({
        id,
        label: CONTACT_TOPIC_LABELS[id],
      })),
    [],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    // Re-validate with the shared zod schema — single source of
    // truth for both client inline errors and server-side checks.
    const parsed = contactSubmissionSchema.safeParse({
      name,
      email,
      topic,
      subject,
      message,
      website,
    });

    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast.error("Please check the form", {
        description: "A few fields need a fix before we can send this.",
      });
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/contact", parsed.data);
      setSubmitted(true);
      toast.success("Message sent", {
        description: "We'll be in touch soon.",
      });
    } catch (err) {
      const description =
        err instanceof ApiError
          ? err.message.replace(/^\d+:\s*/, "") ||
            "Please try again in a moment."
          : "Please try again in a moment.";
      toast.error("Couldn't send your message", { description });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendAnother = () => {
    setSubmitted(false);
    setSubject("");
    setMessage("");
    setTopic("general");
    setErrors({});
  };

  if (submitted) {
    return (
      <Card
        className="flex flex-col items-center px-6 py-12 text-center"
        data-testid="card-contact-success"
      >
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 dark:bg-emerald-500/10">
          <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold">Thanks — we got it</h2>
        <p className="mb-6 max-w-md text-sm text-muted-foreground">
          Your message is on its way to the VoxDex team. We'll reply to{" "}
          <strong className="text-foreground">{email}</strong> within
          two business days.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={handleSendAnother}
            data-testid="button-contact-send-another"
          >
            Send another message
          </Button>
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 md:p-8">
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="contact-name"
            label="Name"
            optional
            error={errors.name}
          >
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              maxLength={120}
              aria-invalid={!!errors.name}
              data-testid="input-contact-name"
            />
          </Field>

          <Field id="contact-email" label="Email" error={errors.email}>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              aria-invalid={!!errors.email}
              data-testid="input-contact-email"
            />
          </Field>
        </div>

        <Field
          id="contact-topic"
          label="What's this about?"
          error={errors.topic}
        >
          <Select
            value={topic}
            onValueChange={(value) => setTopic(value as ContactTopic)}
          >
            <SelectTrigger
              id="contact-topic"
              aria-invalid={!!errors.topic}
              data-testid="select-contact-topic"
            >
              <SelectValue placeholder="Choose a topic" />
            </SelectTrigger>
            <SelectContent>
              {topicOptions.map((opt) => (
                <SelectItem
                  key={opt.id}
                  value={opt.id}
                  data-testid={`select-contact-topic-${opt.id}`}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id="contact-subject"
          label="Subject"
          error={errors.subject}
          hint={`${subjectRemaining} characters left`}
        >
          <Input
            id="contact-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
            placeholder="Give us a one-line summary"
            maxLength={SUBJECT_MAX}
            required
            aria-invalid={!!errors.subject}
            data-testid="input-contact-subject"
          />
        </Field>

        <Field
          id="contact-message"
          label="Message"
          error={errors.message}
          hint={
            messageRemaining < 0
              ? `${Math.abs(messageRemaining)} over the limit`
              : `${messageRemaining} characters left`
          }
        >
          <Textarea
            id="contact-message"
            value={message}
            onChange={(e) =>
              setMessage(e.target.value.slice(0, MESSAGE_MAX))
            }
            placeholder="Tell us what's going on. The more detail, the better we can help."
            rows={7}
            maxLength={MESSAGE_MAX}
            required
            aria-invalid={!!errors.message}
            data-testid="textarea-contact-message"
            className="min-h-[160px] resize-y"
          />
        </Field>

        {/* Honeypot — visually hidden, hidden from assistive tech, and
            tab-skipped. Real users will never fill it; spam bots that
            crawl every input will, and the server drops those silently. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-10000px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label htmlFor="contact-website">
            Leave this field empty
            <input
              id="contact-website"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            By sending this you agree to our{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Privacy Policy
            </Link>
            .
          </p>
          <Button
            type="submit"
            disabled={submitting}
            className={cn(
              "min-w-[160px] bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white",
              "hover:from-violet-500 hover:to-fuchsia-500",
            )}
            data-testid="button-contact-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send message
              </>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface FieldProps {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ id, label, optional, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
          {optional ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          ) : null}
        </Label>
        {hint && !error ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p
          className="text-xs text-destructive"
          data-testid={`error-${id}`}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
