// src/routes/containers.js
import express from 'express';
import createRouter from './containers.create.js';
import controlsRouter from './containers.controls.js';

const router = express.Router();

// Mount both sub-routers; paths remain identical to before
router.use('/create', createRouter);
router.use(controlsRouter);

export default router;