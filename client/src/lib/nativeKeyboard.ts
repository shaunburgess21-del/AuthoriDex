/**
 * Android soft-keyboard decisions for the Capacitor shell.
 *
 * Capacitor 8 SystemBars (`insetsHandling: "css"`) already pads the decor
 * view by the IME inset and zeros `--safe-area-inset-bottom` while the
 * keyboard is visible. That only runs when the activity delivers IME
 * insets, which `android:windowSoftInputMode="adjustResize"` does. The
 * default `adjustUnspecified` mode often pans the WebView as one native
 * view, so the HTML field stays under the keyboard.
 *
 * `@capacitor/keyboard` is intentionally not added. Its Android resize
 * path no-ops when SystemBars is present, and `resizeOnFullScreen` fights
 * the inset padding SystemBars already applies.
 *
 * These helpers are pure so unit tests can cover them without a WebView.
 * `nativeKeyboardListener` is the only caller that touches the DOM, and
 * it no-ops unless the platform is Android Capacitor. Website, PWA, and
 * iOS never receive `android-keyboard-open`.
 */

export const ANDROID_KEYBOARD_OPEN_CLASS = "android-keyboard-open";

/**
 * Same band as `useVisualViewportOffset`: a drop smaller than this is a
 * toolbar or inset tweak, not the soft keyboard (typically 250px+).
 */
export const KEYBOARD_OBSCURE_THRESHOLD_PX = 150;

/** Ancestors matching this keep the IME up (another field, a submit, a mention row). */
export const KEYBOARD_KEEP_FOCUS_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "label",
  "[contenteditable='true']",
  "[contenteditable='']",
  "[role='button']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='radio']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='option']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='slider']",
].join(",");

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "hidden",
  "image",
  "range",
  "color",
]);

export interface KeyboardViewportState {
  closedInnerHeight: number;
}

export interface KeyboardViewportSample {
  innerHeight: number;
  /** `visualViewport.height`, or `innerHeight` when the API is missing. */
  visualHeight: number;
  /**
   * A large height drop without a focused text field does not count as
   * the keyboard. Rotation is applied by the listener, which writes the
   * settled `innerHeight` back into `closedInnerHeight` after
   * `orientationchange` — doing it here would treat the IME animation
   * (blur, height still short) as a new baseline and hide the next open.
   */
  textEntryFocused: boolean;
}

export interface KeyboardViewportSnapshot {
  closedInnerHeight: number;
  open: boolean;
  overlapPx: number;
}

export function reduceKeyboardViewport(
  state: KeyboardViewportState,
  sample: KeyboardViewportSample,
): KeyboardViewportSnapshot {
  const layoutDrop = state.closedInnerHeight - sample.innerHeight;
  const visualDrop = sample.innerHeight - sample.visualHeight;
  const overlapPx = Math.max(0, Math.round(Math.max(layoutDrop, visualDrop)));
  const obscured = overlapPx > KEYBOARD_OBSCURE_THRESHOLD_PX;
  return {
    // Keep the pre-keyboard height while the viewport is short so the
    // close animation and focus moves between fields do not adopt the
    // shrunk height as the new "closed" baseline.
    closedInnerHeight: obscured ? state.closedInnerHeight : sample.innerHeight,
    open: sample.textEntryFocused && obscured,
    overlapPx,
  };
}

export function isTextEntryControl(control: {
  tag: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  contentEditable?: boolean;
}): boolean {
  if (control.disabled || control.readOnly) return false;
  if (control.contentEditable) return true;
  const tag = control.tag.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  const type = (control.type || "text").toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

export function elementIsTextEntry(el: EventTarget | null): el is HTMLElement {
  if (typeof HTMLElement === "undefined" || !(el instanceof HTMLElement)) return false;
  const input = el instanceof HTMLInputElement ? el : null;
  const textArea = el instanceof HTMLTextAreaElement ? el : null;
  return isTextEntryControl({
    tag: el.tagName,
    type: input?.type,
    readOnly: Boolean(input?.readOnly || textArea?.readOnly),
    disabled: Boolean(input?.disabled || textArea?.disabled),
    contentEditable: el.isContentEditable,
  });
}

/** Blur a focused text field. Returns true when the IME should close and Back should stop. */
export function blurTextEntry(el: EventTarget | null): boolean {
  if (!elementIsTextEntry(el)) return false;
  el.blur();
  return true;
}

/** First Android Back dismisses the IME. The next Back navigates. */
export function shouldConsumeBackForKeyboard(textEntryFocused: boolean): boolean {
  return textEntryFocused;
}

export function shouldBlurTextEntryOnPathChange(
  beforePath: string,
  afterPath: string,
  textEntryFocused: boolean,
): boolean {
  return textEntryFocused && beforePath !== afterPath;
}

/** Empty-space taps dismiss. Controls, links, and labels do not — blurring those shifts layout under the finger. */
export function shouldDismissKeyboardOnPointer(args: {
  textEntryFocused: boolean;
  targetKeepsFocus: boolean;
}): boolean {
  return args.textEntryFocused && !args.targetKeepsFocus;
}

export function fieldNeedsScroll(
  rect: { top: number; bottom: number },
  visible: { top: number; bottom: number },
  marginPx = 12,
): boolean {
  return rect.bottom > visible.bottom - marginPx || rect.top < visible.top + marginPx;
}

/**
 * Vertical scroll-snap (Quick Vote, opinion galleries) must not be
 * `scrollIntoView`'d — that yanks the mandatory snap column. Horizontal
 * chip rows (`x`) are fine.
 */
export function snapTypeBlocksVerticalScroll(scrollSnapType: string): boolean {
  const axis = scrollSnapType.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return axis === "y" || axis === "block" || axis === "both";
}
