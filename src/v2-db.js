const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDirectory, 'v2-data.json');

fs.mkdirSync(dataDirectory, { recursive: true });

function createGuildDefaults() {
  return {
    moderation: {
      enabled: false,
      filters: { spam: false, links: false, caps: false, invites: false, blockedWords: [] },
      maxWarnings: 3,
      timeoutMinutes: 10,
      warnings: [],
    },
    welcome: {
      enabled: false,
      channelId: null,
      message: 'Hoş geldin {user}! {server} sunucusuna katıldın. Sunucumuzda artık {count} üye var.',
      leaveEnabled: false,
      leaveChannelId: null,
      leaveMessage: '{username} sunucudan ayrıldı. Sunucumuzda artık {count} üye var.',
      autoRoleId: null,
      includeBots: false,
    },
    rooms: { transferredOwners: {} },
    stats: { enabled: false, messages: 0, joins: 0, leaves: 0, voiceMinutes: 0, days: {} },
  };
}

function createEmptyState() { return { version: 2, guilds: {} }; }

function mergeDefaults(target, defaults) {
  const source = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      source[key] = mergeDefaults(source[key], defaultValue);
    } else if (source[key] === undefined || source[key] === null) {
      source[key] = defaultValue;
    }
  }
  return source;
}

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : createEmptyState();
  if (!source.guilds || typeof source.guilds !== 'object' || Array.isArray(source.guilds)) source.guilds = {};
  for (const guildId of Object.keys(source.guilds)) source.guilds[guildId] = mergeDefaults(source.guilds[guildId], createGuildDefaults());
  source.version = 2;
  return source;
}

let state = createEmptyState();

function loadState() {
  try {
    if (fs.existsSync(dataFile)) state = normalizeState(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
  } catch (error) {
    console.error('V2 veritabanı okunamadı, temiz ayarlarla devam ediliyor:', error.message);
    state = createEmptyState();
  }
}

function saveState() {
  const temporaryFile = dataFile + '.tmp';
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temporaryFile, dataFile);
}

function getGuild(guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = createGuildDefaults();
    saveState();
  } else {
    state.guilds[guildId] = mergeDefaults(state.guilds[guildId], createGuildDefaults());
  }
  return state.guilds[guildId];
}

function updateGuildSection(guildId, section, patch) {
  const guild = getGuild(guildId);
  guild[section] = mergeDefaults({ ...(guild[section] || {}), ...(patch || {}) }, createGuildDefaults()[section]);
  saveState();
  return guild[section];
}

function addWarning(guildId, userId, moderatorId, reason) {
  const moderation = getGuild(guildId).moderation;
  const warning = {
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    userId,
    moderatorId,
    reason: reason || 'Sebep belirtilmedi',
    createdAt: new Date().toISOString(),
  };
  moderation.warnings.push(warning);
  saveState();
  return warning;
}

function getWarnings(guildId, userId) {
  return getGuild(guildId).moderation.warnings.filter((warning) => warning.userId === userId);
}

function clearWarnings(guildId, userId) {
  const moderation = getGuild(guildId).moderation;
  const before = moderation.warnings.length;
  moderation.warnings = moderation.warnings.filter((warning) => warning.userId !== userId);
  saveState();
  return before - moderation.warnings.length;
}

function recordStat(guildId, key, amount = 1) {
  const stats = getGuild(guildId).stats;
  if (!stats.enabled) return;
  if (typeof stats[key] !== 'number') stats[key] = 0;
  stats[key] += amount;
  const day = new Date().toISOString().slice(0, 10);
  if (!stats.days[day] || typeof stats.days[day] !== 'object') stats.days[day] = { messages: 0, joins: 0, leaves: 0, voiceMinutes: 0 };
  if (typeof stats.days[day][key] !== 'number') stats.days[day][key] = 0;
  stats.days[day][key] += amount;
}

function getStats(guildId, days = 7) {
  const stats = getGuild(guildId).stats;
  const cutoff = Date.now() - (Math.max(1, days) * 24 * 60 * 60 * 1000);
  const recentDays = Object.entries(stats.days)
    .filter(([day]) => new Date(day + 'T00:00:00Z').getTime() >= cutoff)
    .sort(([first], [second]) => first.localeCompare(second));
  return { ...stats, days: recentDays };
}

loadState();
saveState();

module.exports = { getGuild, updateGuildSection, addWarning, getWarnings, clearWarnings, recordStat, getStats, saveState };
