/**
 * ZeroLagHub – Technitium DNS Client
 *
 * Responsibilities:
 *  - List all records in a zone (for reconcile / debugging)
 *  - Create A + SRV for internal DNS (used by edgePublisher)
 *  - Delete A + SRV for a given hostname (used by dePublisher / reconcile)
 *
 * API used in other modules:
 *  - dns.listRecords()
 *  - dns.listSRVRecords()
 *  - dns.delARecord({ hostname })
 *  - dns.delSRVRecord({ hostname })
 *  - dns.findRecordsByHostname(hostname)
 *  - dns.addARecord({ hostname, ipAddress })
 *  - dns.addSRVRecord({ hostname, port, target? })
 */

import fetch from "node-fetch";

const API_URL =
  process.env.TECHNITIUM_API_URL || "http://10.60.0.253:5380/api";
const API_TOKEN = process.env.TECHNITIUM_API_TOKEN;
const ZONE = process.env.TECHNITIUM_ZONE || "zerolaghub.quest";

// Internal Velocity / Traefik targets
const ZLH_IPS = ["10.60.0.242", "10.70.0.241"];

if (!API_TOKEN) {
  console.warn(
    "[technitiumClient] ⚠️ TECHNITIUM_API_TOKEN is not set – DNS operations will fail."
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function zoneSuffix() {
  return `.${ZONE}`;
}

function normalizeHostname(hostname) {
  if (!hostname) return "";
  const h = hostname.toLowerCase();
  return h.endsWith(zoneSuffix()) ? h : `${h}${zoneSuffix()}`;
}

function shortHost(hostname) {
  const h = hostname.toLowerCase();
  const suffix = zoneSuffix();
  return h.endsWith(suffix) ? h.slice(0, -suffix.length) : h;
}

async function techGet(pathAndQuery) {
  const url = `${API_URL}${pathAndQuery}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== "ok") {
    const msg = json.errorMessage || "Technitium API error";
    throw new Error(msg);
  }
  return json;
}

async function techPost(path, bodyParams) {
  const url = `${API_URL}${path}`;
  const body = new URLSearchParams(
    Object.entries({
      token: API_TOKEN,
      zone: ZONE,
      ...bodyParams,
    })
  );

  const res = await fetch(url, { method: "POST", body });
  const json = await res.json();
  return json;
}

/* -------------------------------------------------------------------------- */
/*  List Records                                                              */
/* -------------------------------------------------------------------------- */

async function listRecords() {
  try {
    const json = await techGet(
      `/zones/records/get?token=${API_TOKEN}&zone=${encodeURIComponent(
        ZONE
      )}&listZone=true`
    );

    const records = (json.response?.records || []).map((r) => ({
      ...r,
      name: r.domain || r.name || "",
    }));

    console.log(
      `[technitiumClient] ✓ Retrieved ${records.length} records from ${ZONE}`
    );
    return records;
  } catch (err) {
    console.warn(
      `[technitiumClient] ⚠️ Failed to list records for ${ZONE}: ${err.message}`
    );
    return [];
  }
}

async function listSRVRecords() {
  const all = await listRecords();
  return all.filter((r) => r.type === "SRV");
}

async function findRecordsByHostname(hostname) {
  const all = await listRecords();
  const fqdn = normalizeHostname(hostname);
  const short = shortHost(hostname);

  return all.filter((r) => {
    const name = r.name || "";
    return (
      name === fqdn ||
      name === short ||
      name.endsWith(`.${short}`) ||
      name.includes(short)
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  A Records – Add + Delete                                                  */
/* -------------------------------------------------------------------------- */

async function addARecord({ hostname, ipAddress, ttl = 60 }) {
  const fqdn = normalizeHostname(hostname);

  try {
    const json = await techPost("/zones/records/add", {
      domain: fqdn,
      type: "A",
      ttl: String(ttl),
      ipAddress,
    });

    if (json.status === "ok") {
      console.log(
        `[technitiumClient] ➕ Created A record ${fqdn} -> ${ipAddress}`
      );
      return true;
    }

    console.warn(
      `[technitiumClient] ⚠️ Failed to add A record for ${fqdn}: ${json.errorMessage}`
    );
    return false;
  } catch (err) {
    console.warn(
      `[technitiumClient] ⚠️ Error adding A record for ${fqdn}: ${err.message}`
    );
    return false;
  }
}

async function delARecord({ hostname }) {
  const fqdn = normalizeHostname(hostname);

  let anyDeleted = false;

  for (const ip of ZLH_IPS) {
    try {
      const json = await techPost("/zones/records/delete", {
        domain: fqdn,
        type: "A",
        ipAddress: ip,
      });

      if (json.status === "ok") {
        anyDeleted = true;
        console.log(
          `[technitiumClient] 🗑️ Deleted A record ${fqdn} (${ip})`
        );
      } else if (json.errorMessage?.includes("no such record")) {
        console.log(
          `[technitiumClient] (A) Not found: ${fqdn} (${ip}) – already gone`
        );
      } else {
        console.warn(
          `[technitiumClient] ⚠️ Delete A failed for ${fqdn} (${ip}): ${json.errorMessage}`
        );
      }
    } catch (err) {
      console.warn(
        `[technitiumClient] ⚠️ Exception deleting A record for ${fqdn} (${ip}): ${err.message}`
      );
    }
  }

  return anyDeleted;
}

/* -------------------------------------------------------------------------- */
/*  SRV Records (_minecraft._tcp) – Add + Delete                              */
/* -------------------------------------------------------------------------- */

async function addSRVRecord({
  hostname,
  port,
  ttl = 60,
  priority = 0,
  weight = 0,
  target,
}) {
  const fqdn = normalizeHostname(hostname);
  const short = shortHost(hostname);
  const srvDomain = `_minecraft._tcp.${short}.${ZONE}`;
  const srvTarget = normalizeHostname(target || hostname);

  try {
    const json = await techPost("/zones/records/add", {
      domain: srvDomain,
      type: "SRV",
      ttl: String(ttl),
      priority: String(priority),
      weight: String(weight),
      port: String(port),
      target: srvTarget,
    });

    if (json.status === "ok") {
      console.log(
        `[technitiumClient] ➕ Created SRV ${srvDomain} (port=${port}, target=${srvTarget})`
      );
      return true;
    }

    console.warn(
      `[technitiumClient] ⚠️ Failed to add SRV for ${fqdn}: ${json.errorMessage}`
    );
    return false;
  } catch (err) {
    console.warn(
      `[technitiumClient] ⚠️ Error adding SRV for ${fqdn}: ${err.message}`
    );
    return false;
  }
}

async function delSRVRecord({ hostname }) {
  const fqdn = normalizeHostname(hostname);
  const short = shortHost(hostname);
  const srvDomain = `_minecraft._tcp.${short}.${ZONE}`;

  try {
    const getJson = await techGet(
      `/zones/records/get?token=${API_TOKEN}&domain=${encodeURIComponent(
        srvDomain
      )}&zone=${encodeURIComponent(ZONE)}`
    );

    const srvRecords = (getJson.response?.records || []).filter(
      (r) => r.type === "SRV"
    );

    if (srvRecords.length === 0) {
      console.log(
        `[technitiumClient] (SRV) Not found: ${srvDomain} (no SRV records for this name)`
      );
      return false;
    }

    let deleted = 0;

    for (const rec of srvRecords) {
      const rData = rec.rData || rec.rdata || rec.data || {};

      const priority = String(rData.priority ?? 0);
      const weight = String(rData.weight ?? 0);
      const port = String(rData.port ?? 0);
      const target = rData.target || fqdn;

      const json = await techPost("/zones/records/delete", {
        domain: srvDomain,
        type: "SRV",
        priority,
        weight,
        port,
        target,
      });

      if (json.status === "ok") {
        deleted++;
        console.log(
          `[technitiumClient] 🗑️ Deleted SRV record ${srvDomain} (port=${port}, target=${target})`
        );
      } else if (json.errorMessage?.includes("no such record")) {
        console.log(
          `[technitiumClient] (SRV) Not found while deleting: ${srvDomain} (port=${port}, target=${target})`
        );
      } else {
        console.warn(
          `[technitiumClient] ⚠️ SRV delete failed for ${srvDomain}: ${json.errorMessage}`
        );
      }
    }

    return deleted > 0;
  } catch (err) {
    console.error(
      `[technitiumClient] ⚠️ SRV delete failed for ${fqdn}: ${err.message}`
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Health Check                                                              */
/* -------------------------------------------------------------------------- */

async function healthDiag() {
  try {
    const json = await techGet(
      `/zones/records/get?token=${API_TOKEN}&zone=${encodeURIComponent(
        ZONE
      )}&listZone=true`
    );
    const count = json.response?.records?.length || 0;
    return {
      ok: true,
      zone: ZONE,
      recordCount: count,
    };
  } catch (err) {
    return {
      ok: false,
      zone: ZONE,
      error: err.message,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Export Default                                                            */
/* -------------------------------------------------------------------------- */

const technitiumClient = {
  listRecords,
  listSRVRecords,
  findRecordsByHostname,
  addARecord,
  addSRVRecord,
  delARecord,
  delSRVRecord,
  healthDiag,
};

export default technitiumClient;
export {
  listRecords,
  listSRVRecords,
  findRecordsByHostname,
  addARecord,
  addSRVRecord,
  delARecord,
  delSRVRecord,
  healthDiag,
};
