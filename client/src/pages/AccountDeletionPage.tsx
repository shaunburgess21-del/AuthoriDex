import accountDeletionMarkdown from "../../../legal/account-deletion.md?raw";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

const LAST_UPDATED = "October 3, 2026";

/**
 * Public, unauthenticated explanation of account deletion.
 * Linked from the Privacy Policy and Terms. Also on the new-user
 * allowlist so someone still in onboarding can read it.
 */
export default function AccountDeletionPage() {
  return (
    <LegalDocumentPage
      title="Account deletion"
      lastUpdated={LAST_UPDATED}
      markdown={accountDeletionMarkdown}
      backButtonTestId="button-account-deletion-back"
    />
  );
}
