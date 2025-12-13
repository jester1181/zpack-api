export function buildEffectiveConfig(template, overrides = {}, system = {}) {
const templateDefaults = template?.defaults ?? {
cpu: template?.defaultCpu,
memory: template?.defaultMemory,
disk: template?.defaultDisk,
};
const templateNetwork = template?.network ?? (template?.bridge ? { bridge: template.bridge } : {});


const cfg = {
...templateDefaults, // 1) defaults
...templateNetwork, // 2) network
...overrides, // 3) user overrides win
storage: template?.storage ?? overrides?.storage ?? undefined,
};


if (system.vmid !== undefined) cfg.vmid = system.vmid; // 4) system always wins
if (system.ports !== undefined) cfg.ports = system.ports;
if (!Array.isArray(cfg.ports)) cfg.ports = [];
return cfg;
}