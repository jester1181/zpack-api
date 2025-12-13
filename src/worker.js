import { provisionWorker } from './jobs/provisionProcessor.js'

console.log('🚀 ZeroLagHub workers started')
console.log('📋 Listening for provision jobs...')

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down workers...')
  await provisionWorker.close()
  process.exit(0)
})