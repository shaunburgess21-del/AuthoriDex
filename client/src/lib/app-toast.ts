/**
 * App-wide toast entry. Vite and TypeScript alias the `sonner` import to
 * this module so every existing `toast()` call picks up the shorter
 * duration and identical-message dedupe without a call-site sweep.
 *
 * The implementation is loaded by relative path so this file does not
 * import the aliased package name.
 */
import {
  toast as baseToast,
  Toaster,
  useSonner,
  type ExternalToast,
} from "../../../node_modules/sonner/dist/index.mjs";
import { resolveToastOptions } from "@/lib/toast-policy";

type ToastCaller = (message: unknown, data?: ExternalToast) => string | number;

function callWithPolicy(
  kind: "default" | "error",
  fn: ToastCaller,
  message: unknown,
  data?: ExternalToast,
): string | number {
  return fn(message, resolveToastOptions(message, data, kind) as ExternalToast);
}

const toast = Object.assign(
  ((message: unknown, data?: ExternalToast) =>
    callWithPolicy("default", baseToast as ToastCaller, message, data)) as typeof baseToast,
  {
    success: (message: unknown, data?: ExternalToast) =>
      callWithPolicy("default", baseToast.success as ToastCaller, message, data),
    info: (message: unknown, data?: ExternalToast) =>
      callWithPolicy("default", baseToast.info as ToastCaller, message, data),
    warning: (message: unknown, data?: ExternalToast) =>
      callWithPolicy("default", baseToast.warning as ToastCaller, message, data),
    message: (message: unknown, data?: ExternalToast) =>
      callWithPolicy("default", baseToast.message as ToastCaller, message, data),
    loading: (message: unknown, data?: ExternalToast) =>
      callWithPolicy("default", baseToast.loading as ToastCaller, message, data),
    error: (message: unknown, data?: ExternalToast) =>
      callWithPolicy("error", baseToast.error as ToastCaller, message, data),
    custom: baseToast.custom,
    promise: baseToast.promise,
    dismiss: baseToast.dismiss,
    getHistory: baseToast.getHistory,
    getToasts: baseToast.getToasts,
  },
);

export { toast, Toaster, useSonner };
export type { ExternalToast };
