import refundMarkdown from "../../../legal/refund-policy.md?raw";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

const LAST_UPDATED = "April 28, 2026";

export default function RefundPolicyPage() {
  return (
    <LegalDocumentPage
      title="Refund Policy"
      lastUpdated={LAST_UPDATED}
      markdown={refundMarkdown}
      backButtonTestId="button-refund-policy-back"
    />
  );
}
