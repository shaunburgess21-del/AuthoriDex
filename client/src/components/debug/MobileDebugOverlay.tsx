import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface TapInfo {
  count: number;
  tag: string;
  cls: string;
}

export function MobileDebugOverlay() {
  const isMobile = useIsMobile();
  const [viewportW, setViewportW] = useState(window.innerWidth);
  const [tap, setTap] = useState<TapInfo>({ count: 0, tag: "", cls: "" });

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      setTap(prev => ({
        count: prev.count + 1,
        tag: el.tagName ?? "",
        cls: (el.className ?? "").toString().slice(0, 40),
      }));
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  const ua = navigator.userAgent.slice(0, 40);

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        zIndex: 9999,
        background: "rgba(0,0,0,0.78)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: 10,
        padding: "6px 8px",
        borderRadius: 6,
        maxWidth: 200,
        lineHeight: 1.5,
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <div><b>isMobile:</b> {String(isMobile)}</div>
      <div><b>viewportW:</b> {viewportW}</div>
      <div><b>UA:</b> {ua}</div>
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.2)", margin: "4px 0" }} />
      <div><b>taps:</b> {tap.count}</div>
      {tap.tag && (
        <>
          <div><b>tag:</b> {tap.tag}</div>
          <div style={{ wordBreak: "break-all" }}><b>cls:</b> {tap.cls || "(none)"}</div>
        </>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setTap({ count: 0, tag: "", cls: "" }); }}
        style={{
          marginTop: 4,
          fontSize: 9,
          padding: "1px 6px",
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 3,
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Clear
      </button>
    </div>
  );
}
