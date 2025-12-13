// src/services/getCtIp.js
import 'dotenv/config';
import proxmox from './proxmoxClient.js';

// Pull IPv4 from /lxc/{vmid}/interfaces
export async function getCtIp(vmid, node = process.env.PROXMOX_NODE) {
  try {
    const ifaces = await proxmox.getContainerInterfaces(vmid); // node is already handled in proxmoxClient
    for (const intf of ifaces) {
      if (intf.name === 'lo') continue;
      if (Array.isArray(intf['ip-addresses'])) {
        const ipv4 = intf['ip-addresses'].find((ip) =>
          ip['ip-address']?.includes('.')
        );
        if (ipv4) return ipv4['ip-address'];
      }
      if (intf.inet?.includes('.')) {
        return intf.inet.split('/')[0];
      }
    }
    return null;
  } catch (err) {
    console.warn(
      `[getCtIp] failed for vmid=${vmid} on node=${node}:`,
      err.message || err
    );
    return null;
  }
}

// Retry wrapper: loop until IP found or timeout
export async function getCtIpWithRetry(
  vmid,
  node = process.env.PROXMOX_NODE,
  retries = 12,
  delayMs = 10_000
) {
  let last;
  for (let i = 0; i < retries; i++) {
    const ip = await getCtIp(vmid, node);
    if (ip) return ip;
    console.log(
      `[getCtIpWithRetry] IP retry ${i + 1}/${retries}... waiting ${
        delayMs / 1000
      }s`
    );
    last = new Error(`IP not ready (attempt ${i + 1})`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw last || new Error(`could not resolve IP for vmid=${vmid}`);
}

export default { getCtIp, getCtIpWithRetry };
