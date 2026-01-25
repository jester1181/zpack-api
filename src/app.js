import "dotenv/config";
import express from "express";
import cors from "cors";

// ---- ROUTES ----
import healthRouter from "./routes/health.js";
import portRoutes from "./routes/ports.js";
import containers from "./routes/containers.js";
import promSd from "./routes/promSd.js";
import proxRoute from "./routes/proxmox.js";
import instances from "./routes/instances.js";
import templatesRouter from "./routes/templates.js";
import edgeRoutes from "./routes/edge.js";
import debugRoutes from "./routes/debug.js";
import authRoutes from "./routes/auth.js";
import edgeTest from "./routes/edge.test.js";
import serversRouter from "./routes/servers.js";
import { startAgentPoller } from "./utils/agentPoller.js";
import catalogRoutes from "./routes/catalog.js";

/* ======================================================
   APP INIT
   ====================================================== */

const app = express();

/* ======================================================
   START BACKGROUND SERVICES
   ====================================================== */

startAgentPoller();


/* ======================================================
   BODY PARSING  ✅ MUST COME BEFORE ROUTES
   ====================================================== */

app.use(express.json());

/* ======================================================
   CORS CONFIG
   ====================================================== */

const DEV_ORIGINS = [
  "http://10.60.0.66:3000",
  "http://localhost:3000",
  "https://portal.zerolaghub.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow curl / server-to-server
      if (!origin) return callback(null, true);

      if (DEV_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      console.warn("[CORS] Blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);

// Preflight
// ✅ Correct preflight handler
app.options(/.*/, cors());

/* ======================================================
   ROUTES
   ====================================================== */

// Core / health
app.use("/api", healthRouter);
app.use("/api/debug", debugRoutes);

// Auth (APIv2)
app.use("/api/auth", authRoutes);

// Platform
app.use("/api/v2/ports", portRoutes);
app.use("/api/containers", containers);
app.use("/api/instances", instances);
app.use("/api/templates", templatesRouter);
app.use("/api/catalog", catalogRoutes);
app.use("/api/proxmox", proxRoute);
app.use("/api/edge", edgeRoutes);
app.use("/api/servers", serversRouter);


// Prometheus
app.use("/sd", promSd);

// Test routes
app.use("/api/test", edgeTest);

/* ======================================================
   ERROR HANDLER
   ====================================================== */

app.use((err, req, res, next) => {
  console.error("[API ERROR]", err);

  res.status(err.status || 500).json({
    error: true,
    message: err.message || "Internal Server Error",
  });
});

/* ======================================================
   SERVER START
   ====================================================== */

const PORT = process.env.PORT || 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ZPack API listening on http://0.0.0.0:${PORT}`);
});

export default app;
