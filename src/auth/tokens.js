import jwt from "jsonwebtoken";

const SECRET = process.env.API_AUTH_SECRET;
const TTL = Number(process.env.API_AUTH_TTL_SECONDS || 3600);

if (!SECRET) {
  throw new Error("API_AUTH_SECRET is not set");
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      scopes: ["*"], // tighten later
    },
    SECRET,
    { expiresIn: TTL }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
