import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startSnapshotScheduler } from "./jobs/snapshot-scheduler";
import { runDataIngestion } from "./jobs/ingest";

// Data ingestion interval: 8 hours (matches X API cache TTL)
const INGESTION_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours in ms

let lastIngestionTime: Date | null = null;

async function scheduledIngestion() {
  log("[Ingestion Scheduler] Starting scheduled data ingestion...");
  const startTime = new Date();
  
  try {
    const result = await runDataIngestion();
    lastIngestionTime = new Date();
    log(`[Ingestion Scheduler] Complete: ${result.processed} processed, ${result.errors} errors, ${result.duration}ms`);
    log(`[Ingestion Scheduler] Next ingestion scheduled for: ${new Date(Date.now() + INGESTION_INTERVAL_MS).toISOString()}`);
  } catch (error) {
    log(`[Ingestion Scheduler] Error during ingestion: ${error}`);
  }
}

function startIngestionScheduler() {
  log(`[Ingestion Scheduler] Starting (interval: ${INGESTION_INTERVAL_MS / 1000 / 60 / 60} hours)`);
  
  // Run initial ingestion after 30 second delay (let server fully initialize)
  setTimeout(() => {
    scheduledIngestion();
  }, 30000);
  
  // Schedule recurring ingestion every 8 hours
  setInterval(() => {
    scheduledIngestion();
  }, INGESTION_INTERVAL_MS);
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve attached assets (profile images, etc.)
app.use("/attached_assets", express.static(path.resolve(import.meta.dirname, "..", "attached_assets")));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // Start hourly snapshot scheduler (captures data points for graphs)
    startSnapshotScheduler(60 * 60 * 1000);
    
    // Start data ingestion scheduler (fetches fresh API data every 8 hours)
    startIngestionScheduler();
  });
})();
