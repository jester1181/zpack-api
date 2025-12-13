// src/services/proxyClient.js
// Writes Traefik dynamic config to remote proxy VM over SSH.
// Uses game-specific entryPoints (matching traefik.yml defaults).

import { exec } from 'child_process';
import path from 'path';

const TRAEFIK_HOST = process.env.TRAEFIK_HOST || 'zlhproxy@100.71.44.12';
const DYNAMIC_DIR = '/etc/traefik/dynamic';

/**
 * Map of game → { entryPoint, protocol, defaultPort }
 * Must align exactly with traefik.yml entryPoints.
 */
const GAME_ENTRYPOINTS = {
  minecraft: { entryPoint: 'minecraft', protocol: 'tcp', defaultPort: 25565 },
  mcp:       { entryPoint: 'minecraft', protocol: 'tcp', defaultPort: 25565 },
  rust:      { entryPoint: 'rust', protocol: 'udp', defaultPort: 28015 },
  terraria:  { entryPoint: 'terraria', protocol: 'tcp', defaultPort: 7777 },
  projectzomboid: { entryPoint: 'projectzomboid', protocol: 'udp', defaultPort: 16261 },
  valheim:   { entryPoint: 'valheim', protocol: 'udp', defaultPort: 2456 },
  palworld:  { entryPoint: 'palworld', protocol: 'udp', defaultPort: 8211 },
};

/**
 * Execute a remote command to write a file on the Traefik host.
 */
async function writeRemoteConfig(filename, content) {
  return new Promise((resolve, reject) => {
    const remotePath = path.posix.join(DYNAMIC_DIR, filename);
    const cmd = `ssh ${TRAEFIK_HOST} "cat > ${remotePath}"`;
    const child = exec(cmd, (err) => {
      if (err) return reject(err);
      resolve();
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

/**
 * Remove a file from the Traefik host.
 */
async function removeRemoteConfig(filename) {
  return new Promise((resolve, reject) => {
    const remotePath = path.posix.join(DYNAMIC_DIR, filename);
    const cmd = `ssh ${TRAEFIK_HOST} "rm -f ${remotePath}"`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * ✅ Check whether a dynamic YAML already exists for a hostname.
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
export async function routeExists(hostname) {
  return new Promise((resolve) => {
    const cmd = `ssh ${TRAEFIK_HOST} "test -f ${DYNAMIC_DIR}/${hostname}.yml"`;
    exec(cmd, (err) => {
      if (err) {
        console.log(`[proxyClient] No route file found for ${hostname}`);
        resolve(false);
      } else {
        console.log(`[proxyClient] Route file exists for ${hostname}`);
        resolve(true);
      }
    });
  });
}

/**
 * Add a dynamic proxy config for a container.
 * @param {object} opts
 * @param {number} opts.vmid
 * @param {string} opts.hostname
 * @param {number} opts.externalPort
 * @param {string} opts.ctIp
 * @param {number} opts.ctPort
 * @param {string} opts.game
 * @param {string} opts.protocol (optional override)
 */
export async function addProxyConfig({ vmid, hostname, externalPort, ctIp, ctPort, game, protocol }) {
  if (!hostname || !externalPort || !ctIp || !ctPort) {
    throw new Error(`[proxyClient] Missing required params`);
  }

  const gameMeta = GAME_ENTRYPOINTS[game] || { entryPoint: 'minecraft', protocol: 'tcp', defaultPort: 25565 };
  const entryPoint = gameMeta.entryPoint;
  const proto = protocol || gameMeta.protocol;

  const safeName = `${hostname}-${vmid}`;  // safer unique key
  const file = `${safeName}.yml`;
  let yaml = '';

  if (proto === 'tcp') {
    yaml = `
tcp:
  routers:
    ${safeName}-router:
      entryPoints:
        - ${entryPoint}
      rule: "HostSNI(\`*\`)"
      service: ${safeName}-svc

  services:
    ${safeName}-svc:
      loadBalancer:
        servers:
          - address: "${ctIp}:${ctPort}"
`;
  } else if (proto === 'udp') {
    yaml = `
udp:
  routers:
    ${safeName}-router:
      entryPoints:
        - ${entryPoint}
      service: ${safeName}-svc

  services:
    ${safeName}-svc:
      loadBalancer:
        servers:
          - address: "${ctIp}:${ctPort}"
`;
  } else {
    throw new Error(`[proxyClient] Unsupported protocol=${proto}`);
  }

  await writeRemoteConfig(file, yaml);
  console.log(`[proxyClient] ✓ wrote remote config ${file} (${proto.toUpperCase()} ${hostname} → ${ctIp}:${ctPort} on entryPoint ${entryPoint})`);
}

/**
 * Remove a dynamic proxy config.
 */
export async function removeProxyConfig({ hostname }) {
  const file = `${hostname}.yml`;
  try {
    await removeRemoteConfig(file);
    console.log(`[proxyClient] ✓ removed remote config ${file}`);
  } catch (err) {
    console.warn(`[proxyClient] remove failed: ${err.message}`);
  }
}

export default { addProxyConfig, removeProxyConfig, routeExists };
