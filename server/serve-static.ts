import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets (JS/CSS chunks) are immutable -- cache them long-term.
  // index.html is handled separately below with no-cache headers.
  app.use(express.static(distPath, {
    maxAge: "1y",
    immutable: true,
    index: false,
  }));

  // SPA fallback: always serve the latest index.html with no-cache so
  // browsers never use a stale entry point after a deploy.
  app.use("*", (_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
