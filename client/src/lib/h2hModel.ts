/**
 * Client-side re-export of the shared H2H model.
 *
 * The canonical implementation lives in `shared/h2hModel.ts` so the Express
 * server and the Vite-built client both compute identical probabilities.
 * This thin wrapper keeps the `@/lib/h2hModel` import path stable for the
 * UI while avoiding duplication.
 */

export {
  h2hModelProbability,
  type H2hModelSide,
  type H2hModelResult,
  type MomentumLabel,
} from "@shared/h2hModel";
