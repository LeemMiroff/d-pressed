export const CONFIG_SCHEMA_VERSION = 1;

function isSettingValue(value) {
  return typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean';
}

export function applySettings(config, saved) {
  for (const [path, value] of Object.entries(saved || {})) {
    if (!isSettingValue(value)) continue;
    const keys = path.split('.');
    let target = config;
    for (let index = 0; index < keys.length - 1; index += 1) target = target?.[keys[index]];
    const key = keys.at(-1);
    if (target && key in target && typeof target[key] === typeof value) target[key] = value;
  }
}

export function migrateSettings(saved) {
  if (!saved || typeof saved !== 'object') return {};
  const version = Number(saved._schemaVersion) || 0;
  const migrated = { ...saved };
  if (version < CONFIG_SCHEMA_VERSION) migrated._schemaVersion = CONFIG_SCHEMA_VERSION;
  return migrated;
}

export function getSettingsTimestamp(saved) {
  return Number(saved?._savedAt) || 0;
}

export async function loadConfig(defaults, fetchImpl = globalThis.fetch, storage = globalThis.localStorage) {
  const config = structuredClone(defaults);
  let serverSettings = null;
  try {
    const response = await fetchImpl(`./settings.json?load=${Date.now()}`, { cache: 'no-store' });
    if (response.ok) serverSettings = migrateSettings(await response.json());
  } catch {
    serverSettings = null;
  }

  let localSettings = null;
  try {
    localSettings = migrateSettings(JSON.parse(storage?.getItem('d-pressed-inspector-settings') || 'null'));
  } catch {
    localSettings = null;
  }

  const serverTime = getSettingsTimestamp(serverSettings);
  const localTime = getSettingsTimestamp(localSettings);
  if (serverSettings && (!localSettings || !serverTime || serverTime >= localTime)) applySettings(config, serverSettings);
  else if (localSettings) applySettings(config, localSettings);
  return config;
}
