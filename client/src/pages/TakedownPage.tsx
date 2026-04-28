import takedownMarkdown from "../../../legal/content-takedown-policy.md?raw";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

const LAST_UPDATED = "April 28, 2026";

export default function TakedownPage() {
  return (
    <LegalDocumentPage
      title="Content & Takedown Policy"
      lastUpdated={LAST_UPDATED}
      markdown={takedownMarkdown}
      backButtonTestId="button-takedown-back"
    />
  );
}