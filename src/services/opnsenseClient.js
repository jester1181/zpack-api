// src/services/opnsenseClient.js
// Uses OPNsense HAProxy plugin API (add_backend → add_server → add_frontend → reconfigure)

import axios from 'axios';
import https from 'https';

const BASE   = process.env.OPNSENSE_API_URL;
const KEY    = process.env.OPNSENSE_API_KEY;
const SECRET = process.env.OPNSENSE_API_SECRET;
const TIMEOUT_MS = Number(process.env.OPNSENSE_TIMEOUT_MS || 10000);

const client = axios.create({
  baseURL: BASE,
  timeout: TIMEOUT_MS,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  auth: { username: KEY, password: SECRET },
  headers: { 'Content-Type': 'application/json' },
});

// ----------------------------------------------------------------------
// Health
// ----------------------------------------------------------------------
export async function health() {
  try {
    const { data } = await client.get('/haproxy/service/status');
    return data?.status ? true : false;
  } catch (e) {
    console.warn('[opnsense] health check failed:', e.message);
    return false;
  }
}

// ----------------------------------------------------------------------
// Create HAProxy backend + server + frontend
// ----------------------------------------------------------------------
export async function createPortForward({ vmid, publicPort, privateIp, privatePort }) {
  const backendName = `zpack-backend-${vmid}-${publicPort}`;
  const serverName  = `srv-${vmid}-${publicPort}`;
  const frontendName = `zpack-frontend-${vmid}-${publicPort}`;

  try {
    // 1. Create backend
    const backendPayload = {
      Backend: {
        name: backendName,
        description: `Backend for vmid=${vmid}`,
        mode: 'tcp',
        enabled: '1',
      },
    };
    console.log('[opnsense] add_backend payload=', backendPayload);
    const backendRes = await client.post('/haproxy/settings/add_backend', backendPayload);
    const backendUuid = backendRes?.data?.uuid;
    console.log('[opnsense] add_backend result=', backendRes.data);

    // 2. Create server bound to backend
    const serverPayload = {
      Server: {
        name: serverName,
        description: `Server for vmid=${vmid}`,
        address: privateIp,
        port: String(privatePort),
        enabled: '1',
        backend: backendUuid,
      },
    };
    console.log('[opnsense] add_server payload=', serverPayload);
    const serverRes = await client.post('/haproxy/settings/add_server', serverPayload);
    console.log('[opnsense] add_server result=', serverRes.data);

    // 3. Create frontend bound to backend
    const frontendPayload = {
      Frontend: {
        name: frontendName,
        description: `Frontend for vmid=${vmid}`,
        enabled: '1',
        listenAddress: '0.0.0.0',
        listenPort: String(publicPort),
        mode: 'tcp',
        default_backend: backendUuid,
      },
    };
    console.log('[opnsense] add_frontend payload=', frontendPayload);
    const frontendRes = await client.post('/haproxy/settings/add_frontend', frontendPayload);
    const frontendUuid = frontendRes?.data?.uuid;
    console.log('[opnsense] add_frontend result=', frontendRes.data);

    // 4. Apply changes
    const reconfigRes = await client.post('/haproxy/service/reconfigure');
    console.log('[opnsense] reconfigure result=', reconfigRes.data);

    return { ok: true, backend: backendRes.data, server: serverRes.data, frontend: frontendRes.data, reconfig: reconfigRes.data };
  } catch (e) {
    console.error('[opnsense] createPortForward error:');
    if (e.response?.data) {
      console.error('Response body:', JSON.stringify(e.response.data, null, 2));
    } else {
      console.error(e.message || e);
    }
    throw e;
  }
}

// ----------------------------------------------------------------------
// Delete frontend + backend (and implicitly server)
// ----------------------------------------------------------------------
export async function deletePortForward({ backendUuid, frontendUuid }) {
  try {
    if (frontendUuid) {
      await client.post(`/haproxy/settings/del_frontend/${frontendUuid}`);
    }
    if (backendUuid) {
      await client.post(`/haproxy/settings/del_backend/${backendUuid}`);
    }
    const reconfigRes = await client.post('/haproxy/service/reconfigure');
    console.log('[opnsense] delete reconfigure result=', reconfigRes.data);
    return { ok: true, reconfig: reconfigRes.data };
  } catch (e) {
    console.error('[opnsense] deletePortForward error:', e.response?.data || e.message);
    throw e;
  }
}

export default { health, createPortForward, deletePortForward };
