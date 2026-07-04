import termsMarkdown from "../../../legal/terms-of-service.md?raw";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

const LAST_UPDATED = "July 4, 2026";
const EFFECTIVE_DATE = "April 28, 2026";

export default function TermsPage() {
  return (
    <LegalDocumentPage
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      effectiveDate={EFFECTIVE_DATE}
      markdown={termsMarkdown}
      backButtonTestId="button-terms-back"
    />
  );
}
