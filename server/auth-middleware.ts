import { Request, Response, NextFunction } from "express";
import { createClient } from '@supabase/supabase-js';
import { eq } from "drizzle-orm";
import { db } from "./db";
import { profiles } from "@shared/schema";
import { isAdminRole, resolveProfileRole } from "./utils/authz";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  userRole?: string;
}

/**
 * Middleware to verify Supabase JWT and attach the server-controlled profile role.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Unauthorized - Missing header" });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Unauthorized - Invalid token" });
    }

    const [profile] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);

    req.userId = user.id;
    req.userEmail = user.email || undefined;
    req.userRole = resolveProfileRole(profile?.role);


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

// Keep the optionalAuth function exactly as it was
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        const [profile] = await db
          .select({ role: profiles.role })
          .from(profiles)
          .where(eq(profiles.id, user.id))
          .limit(1);

        req.userId = user.id;
        req.userEmail = user.email || undefined;
        req.userRole = resolveProfileRole(profile?.role);
      }
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    req.sessionId = `anon_${Buffer.from(ip + userAgent).toString('base64').substring(0, 32)}`;
    next();
  } catch (error) {
    req.sessionId = `anon_${Date.now()}`;
    next();
  }
}