// src/test-getip.js

import { getCtIp } from './services/getCtIp.js';

const vmid = process.argv[2];
const node = 'zlh-prod1';   // force node for test

(async () => {
  const ip = await getCtIp(vmid, node);
  console.log(`CT ${vmid} IP:`, ip || 'No IP found');
})();
