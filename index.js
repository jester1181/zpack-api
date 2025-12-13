import express from 'express';
import dotenv from 'dotenv';
import { provisionQueue } from './src/queues/provisionQueue.js';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/provision', async (req, res) => {
  const job = await provisionQueue.add('provision', req.body);
  res.json({ jobId: job.id });
});

app.listen(3000, () => {
  console.log('API running on http://localhost:3000');
});
