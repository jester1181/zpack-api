import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../services/prisma.js";
import { signToken } from "../auth/tokens.js";

const router = Router();


router.post("/register", async (req, res) => {
  const {
    email,
    username,
    password,
    firstName,
    lastName,
    displayName,
  } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existing) {
    return res.status(409).json({ error: "User already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      firstName,
      lastName,
      displayName: displayName ?? username,
    },
  });

  const token = signToken(user);

  res.status(201).json({ ok: true, token });
});


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

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!user) {
    return res.status(404).json({ ok: false, error: "User not found" });
  }

  res.json({ ok: true, user });
});

router.patch("/me", requireAuth, async (req, res) => {
  const { firstName, lastName, displayName } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(firstName !== undefined && { firstName }),
      ...(lastName !== undefined && { lastName }),
      ...(displayName !== undefined && { displayName }),
    },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      firstName: true,
      lastName: true,
    },
  });

  res.json({ ok: true, user });
});



// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  try {
    // Stateless JWT logout
    // Client is responsible for deleting the token
    return res.json({ ok: true, message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ error: "Logout failed" });
  }
});


export default router;
