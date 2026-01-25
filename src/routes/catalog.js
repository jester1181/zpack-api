import express from "express";
import { getDevCatalog, getGameCatalog } from "../utils/catalog.js";

const router = express.Router();

/**
 * GET /api/catalog/dev
 */
router.get("/dev", async (req, res) => {
  try {
    const catalog = await getDevCatalog();
    res.json(catalog);
  } catch (err) {
    console.error("Catalog dev error:", err);
    res.status(500).json({ error: "Failed to load dev catalog" });
  }
});

/**
 * GET /api/catalog/game
 */
router.get("/game", async (req, res) => {
  try {
    const catalog = await getGameCatalog();
    res.json(catalog);
  } catch (err) {
    console.error("Catalog game error:", err);
    res.status(500).json({ error: "Failed to load game catalog" });
  }
});

export default router;