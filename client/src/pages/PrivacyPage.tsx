import privacyMarkdown from "../../../legal/privacy-policy.md?raw";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

const LAST_UPDATED = "April 28, 2026";
const EFFECTIVE_DATE = "April 28, 2026";

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      effectiveDate={EFFECTIVE_DATE}
      markdown={privacyMarkdown}
      backButtonTestId="button-privacy-back"
    />
  );
}
