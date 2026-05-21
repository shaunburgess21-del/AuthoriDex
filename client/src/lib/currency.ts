/**
 * Client-side re-export of the shared currency module so client
 * code can keep its `@/lib/...` import convention. Adding a wrapper
 * here (instead of importing `@shared/currency` everywhere) means
 * any future client-only formatting helpers — e.g. JSX-returning
 * variants that wrap the symbol in a span — can live alongside
 * these re-exports without a churn refactor.
 */

export {
  CURRENCY,
  formatVox,
  formatVoxCompact,
  formatVoxDelta,
  formatVoxPrice,
  voxWord,
} from "@shared/currency";
