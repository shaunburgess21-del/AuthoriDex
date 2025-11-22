import { Request, Response, NextFunction } from "express";
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Create a Supabase client for verifying JWTs
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AuthRequest extends Request {
  userId?: string;
}

/**
 * Middleware to verify Supabase JWT and extract user ID
 * Attaches userId to request object if valid
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Get the authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Unauthorized - Missing or invalid authorization header" });
    }

    // Extract the token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify the JWT using Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Unauthorized - Invalid or expired token" });
    }

    // Attach the verified user ID to the request
    req.userId = user.id;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Internal server error during authentication" });
  }
}
