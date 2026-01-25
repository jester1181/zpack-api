import fetch from "node-fetch";

const ARTIFACT_BASE = "http://10.60.0.251:8080";

/* ======================================================
   DEV CATALOG
   ====================================================== */

export async function getDevCatalog() {
  const res = await fetch(`${ARTIFACT_BASE}/devcontainer/_catalog.json`);
  if (!res.ok) {
    throw new Error("Failed to fetch dev catalog");
  }

  const data = await res.json();

  const runtimes = (data.runtimes || [])
    .filter(rt => rt.id && Array.isArray(rt.versions) && rt.versions.length > 0)
    .map(rt => ({
      id: rt.id,
      versions: rt.versions.sort()
    }));

  return { runtimes };
}

/* ======================================================
   GAME CATALOG
   ====================================================== */

export async function getGameCatalog() {
  const res = await fetch(`${ARTIFACT_BASE}/_catalog.json`);
  if (!res.ok) {
    throw new Error("Failed to fetch game catalog");
  }

  const data = await res.json();

  const games = (data.games || [])
    .map(game => {
      const variants = (game.variants || [])
        .filter(v =>
          v.id &&
          v.id !== "pupur" &&              // kill typo
          Array.isArray(v.versions) &&
          v.versions.length > 0
        )
        .map(v => ({
          id: v.id,
          versions: v.versions.sort()
        }));

      return {
        id: game.id,
        variants
      };
    })
    .filter(game => game.variants.length > 0);

  return { games };
}