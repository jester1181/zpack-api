import { verifyToken } from "../auth/tokens.js";

export default function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const token = header.slice(7); // remove "Bearer "
    const payload = verifyToken(token);

    // Attach authenticated user context
    req.user = {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      scopes: payload.scopes || [],
    };

    next();
  } catch (err) {
    console.warn("[AUTH] Invalid token:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
