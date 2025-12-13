import { unpublish } from './src/services/dePublisher.js'
await unpublish({
  hostname: 'mc-test-5095.zerolaghub.quest',
  vmid: 5095,
  game: 'minecraft',
  ports: [50065]
})
