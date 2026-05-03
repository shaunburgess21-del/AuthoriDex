import { Request, Response, NextFunction } from "express";
import { createClient } from '@supabase/supabase-js';
import { eq } from "drizzle-orm";
import { db } from "./db";
import { profiles } from "@shared/schema";
import { isAdminRole, resolveProfileRole } from "./utils/authz";
import { readFdxSid } from "./lib/anonIdentity";

function requireEnv(name: "SUPABASE_URL" | "SUPABASE_ANON_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for auth middleware`);
  }
  return value;
}

const supabaseUrl = requireEnv("SUPABASE_URL");
const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  userRole?: string;
}

export interface ResolvedAuthContext {
  userId: string;
  userEmail?: string;
  userRole: string;
}

function getBearerToken(authHeader?: string | string[]): string | null {
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.substring(7);
}

export async function resolveAuthContextFromHeader(authHeader?: string | string[]): Promise<ResolvedAuthContext | null> {
  const token = getBearerToken(authHeader);
  if (!token) {
    return null;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  return {
    userId: user.id,
    userEmail: user.email || undefined,
    userRole: resolveProfileRole(profile?.role),
  };
}

/**
 * Middleware to verify Supabase JWT and attach the server-controlled profile role.
 *
 * Perf note: the global /api/ middleware (see server/index.ts) already resolves
 * the auth context for rate-limit keying. If that succeeded (req.userId set),
 * we reuse it here instead of doing a second Supabase.getUser + DB role lookup.
 * This cuts ~1 Supabase round-trip + 1 DB query off every authenticated request.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.userId && req.userRole) {
      // Global middleware already resolved auth — reuse it.
      return next();
    }

    const authContext = await resolveAuthContextFromHeader(req.headers.authorization);
    if (!authContext) {
      return res.status(401).json({ error: "Unauthorized - Invalid or missing token" });
    }

    req.userId = authContext.userId;
    req.userEmail = authContext.userEmail;
    req.userRole = authContext.userRole;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * NEW: Middleware to enforce Admin access
 * Must be used AFTER requireAuth
 */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "Unauthorized - Log in first" });
  }

  if (!isAdminRole(req.userRole)) {
    return res.status(403).json({ error: "Forbidden - Admins only" });
  }

  next();
}

// Same token-reuse logic as requireAuth. If global middleware already
// populated req.userId, skip the redundant Supabase + DB lookup.
//
// req.sessionId resolution order (Phase 4):
//   1. fdx_sid cookie — set by anonIdentityMiddleware on every /api/*
//      request, so this is the expected path for anonymous users.
//   2. anon_<base64(IP+UA)> hash — defence-in-depth fallback for the
//      vanishingly rare case where the cookie is somehow absent (e.g.
//      a non-/api/* route that mounts optionalAuth directly, before
//      anonIdentityMiddleware has run, or a client that strips cookies).
//      Carried over from the pre-Phase-4 implementation; should never
//      fire in practice.
//   3. anon_<timestamp> last-resort — only on a thrown exception in the
//      auth-resolution path. Keeps the request alive without crashing.
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!(req.userId && req.userRole)) {
      const authContext = await resolveAuthContextFromHeader(req.headers.authorization);
      if (authContext) {
        req.userId = authContext.userId;
        req.userEmail = authContext.userEmail;
        req.userRole = authContext.userRole;
      }
    }
    const fdxSid = readFdxSid(req);
    if (fdxSid) {
      req.sessionId = `anon_${fdxSid}`;
    } else {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      req.sessionId = `anon_${Buffer.from(ip + userAgent).toString('base64').substring(0, 32)}`;
    }
    next();
  } catch (error) {
    req.sessionId = `anon_${Date.now()}`;
    next();
  }
}