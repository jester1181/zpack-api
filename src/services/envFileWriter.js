// src/services/envFileWriter.js
import { Client } from 'ssh2';
import fs from 'fs/promises';
import fssync from 'fs';   // for reading private key
import path from 'path';

/**
 * Writes an env file for a VMID to /etc/zlh/slots on the Proxmox host.
 * Uses SFTP over SSH (no remote exec needed).
 */
export async function writeSlotEnv(vmid, data) {
  const envLines = Object.entries(data)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // Write to a temp file locally
  const tmpPath = path.join('/tmp', `${vmid}.env`);
  await fs.writeFile(tmpPath, envLines, { mode: 0o600 });

  const remotePath = `/etc/zlh/slots/${vmid}.env`;

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          sftp.fastPut(tmpPath, remotePath, (err2) => {
            conn.end();
            if (err2) return reject(err2);
            console.log(`[envFileWriter] wrote env file for vmid=${vmid} → ${remotePath}`);
            resolve(remotePath);
          });
        });
      })
      .on('error', (err) => reject(err))
      .connect({
        host: process.env.PROXMOX_SSH_HOST,   // e.g. zlh-prod1
        username: process.env.PROXMOX_SSH_USER || 'apiuser',
        privateKey: fssync.readFileSync(process.env.PROXMOX_SSH_KEY),
      });
  });
}

/**
 * Removes the env file for a VMID from /etc/zlh/slots on the Proxmox host.
 */
export async function removeSlotEnv(vmid) {
  const remotePath = `/etc/zlh/slots/${vmid}.env`;

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          sftp.unlink(remotePath, (err2) => {
            conn.end();
            if (err2 && err2.code !== 2) return reject(err2); // ignore "no such file"
            resolve(true);
          });
        });
      })
      .on('error', (err) => reject(err))
      .connect({
        host: process.env.PROXMOX_SSH_HOST,
        username: process.env.PROXMOX_SSH_USER || 'apiuser',
        privateKey: fssync.readFileSync(process.env.PROXMOX_SSH_KEY),
      });
  });
}
