// /opt/zpack-api/src/app.js
import 'dotenv/config'
import express from 'express'
import portRoutes from './routes/ports.js'
import containers from './routes/containers.js'
import promSd from './routes/promSd.js'
import proxRoute from './routes/proxmox.js'
import instances from './routes/instances.js';
import templatesRouter from './routes/templates.js';
import edgeRoutes from './routes/edge.js';
import debugRoutes from './routes/debug.js';

//Testing route
import edgeTest from './routes/edge.test.js';

const app = express()

app.use('/api/debug', debugRoutes);
app.use(express.json())
app.use('/api/v2/ports', portRoutes)
app.use('/api/containers', containers)
app.use('/sd', promSd)
app.use('/api/proxmox', proxRoute)
app.use('/api/instances', instances);
app.use(templatesRouter);
app.use('/api/edge', edgeRoutes);

//testing route 
app.use('/api/test', edgeTest);

// --- DEV ERROR HANDLER (temporary) ---
app.use((err, req, res, next) => {
  const status = err.httpCode || 500;
  const payload = {
    ok: false,
    error: err.message || String(err),
  };
  if (process.env.NODE_ENV !== 'production' && err && err.stack) {
    payload.stack = err.stack.split('\n').slice(0, 12); // first lines only
  }
  console.error('[ERR]', err);
  res.status(status).json(payload);
});


// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ---- add this block ----
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => {
  console.log(`ZeroLagHub API listening on http://${HOST}:${PORT}`)
})
// ------------------------



export default app
