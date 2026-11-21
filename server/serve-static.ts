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
  // index.html is forced to no-cache so browsers always fetch the latest
  // entry point after a deploy.
  app.use(express.static(distPath, {
    maxAge: "1y",
    immutable: true,
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));

  // `/leaderboard` is an alias of the celebrity board. The SPA also
  // redirects, and Vercel does the same at the edge. Query strings pass
  // through; the fragment stays in the browser.
  app.use((req, res, next) => {
    if (req.path !== "/leaderboard" && req.path !== "/leaderboard/") {
      next();
      return;
    }
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(307, `/rankings${qs}`);
  });

  // SPA fallback: always serve the latest index.html with no-cache so
  // browsers never use a stale entry point after a deploy. `/rankings`
  // and every other client route hit this on a direct load.
  app.use("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
