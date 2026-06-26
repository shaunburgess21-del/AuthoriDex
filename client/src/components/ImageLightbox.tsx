import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
  footer?: ReactNode;
  zIndexClass?: string;
  imageClassName?: string;
  testId?: string;
  closeButtonTestId?: string;
}

export function ImageLightbox({
  open,
  src,
  alt,
  onClose,
  footer,
  zIndexClass = "z-[100]",
  imageClassName,
  testId,
  closeButtonTestId,
}: ImageLightboxProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn("fixed inset-0", zIndexClass)}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      data-testid={testId}
    >
      <button
        type="button"
        className="absolute inset-0 w-full h-full border-0 p-0 bg-black/90 cursor-default touch-manipulation"
        onClick={onClose}
        aria-label="Close image preview"
      />

      <button
        type="button"
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors touch-manipulation"
        onClick={onClose}
        aria-label="Close"
        data-testid={closeButtonTestId}
      >
        <X className="h-6 w-6 text-white" />
      </button>

      <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <img
          src={src}
          alt={alt}
          className={cn(
            "pointer-events-auto w-auto h-auto max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl select-none",
            imageClassName,
          )}
          draggable={false}
        />
      </div>

      {footer ? (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 pointer-events-auto">
          {footer}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
