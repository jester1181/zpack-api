import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../services/prisma.js";
import { signToken } from "../auth/tokens.js";

const router = Router();

router.post("/login", async (req, res) => {
  console.log("LOGIN BODY:", req.body);

  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { username: identifier },
      ],
    },
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken(user);
  return res.json({ token });
});

import requireAuth from "../middleware/requireAuth.js";

router.get("/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.user,
  });
});


export default router;
