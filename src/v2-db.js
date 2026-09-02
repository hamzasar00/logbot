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
    stats: { enabled: false, messages: 0, joins: 0, leaves: 0, voiceMinutes: 0, days: {}, users: {} },
    levels: {
      enabled: false,
      xpPerMessage: 15,
      cooldownSeconds: 60,
      announce: true,
      announcementChannelId: null,
      rewards: {},
      users: {},
    },
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

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGuild(value) {
  const defaults = createGuildDefaults();
  const guild = mergeDefaults(isPlainObject(value) ? value : {}, defaults);

  if (!isPlainObject(guild.moderation)) guild.moderation = {};
  guild.moderation = mergeDefaults(guild.moderation, defaults.moderation);
  if (!isPlainObject(guild.moderation.filters)) guild.moderation.filters = {};
  guild.moderation.filters = mergeDefaults(guild.moderation.filters, defaults.moderation.filters);
  if (!Array.isArray(guild.moderation.filters.blockedWords)) guild.moderation.filters.blockedWords = [];
  guild.moderation.filters.blockedWords = guild.moderation.filters.blockedWords
    .filter((word) => typeof word === 'string' && word.trim())
    .map((word) => word.trim().toLocaleLowerCase('tr-TR'));
  if (!Array.isArray(guild.moderation.warnings)) guild.moderation.warnings = [];
  guild.moderation.warnings = guild.moderation.warnings.filter((warning) => isPlainObject(warning));
  if (typeof guild.moderation.enabled !== 'boolean') guild.moderation.enabled = defaults.moderation.enabled;
  if (!Number.isInteger(guild.moderation.maxWarnings) || guild.moderation.maxWarnings < 1 || guild.moderation.maxWarnings > 10) guild.moderation.maxWarnings = defaults.moderation.maxWarnings;
  if (!Number.isFinite(guild.moderation.timeoutMinutes) || guild.moderation.timeoutMinutes < 1 || guild.moderation.timeoutMinutes > 10080) guild.moderation.timeoutMinutes = defaults.moderation.timeoutMinutes;
  for (const key of ['spam', 'links', 'caps', 'invites']) {
    if (typeof guild.moderation.filters[key] !== 'boolean') guild.moderation.filters[key] = defaults.moderation.filters[key];
  }

  if (!isPlainObject(guild.welcome)) guild.welcome = {};
  guild.welcome = mergeDefaults(guild.welcome, defaults.welcome);
  for (const key of ['enabled', 'leaveEnabled', 'includeBots']) {
    if (typeof guild.welcome[key] !== 'boolean') guild.welcome[key] = defaults.welcome[key];
  }
  for (const key of ['message', 'leaveMessage']) {
    if (typeof guild.welcome[key] !== 'string') guild.welcome[key] = defaults.welcome[key];
  }

  if (!isPlainObject(guild.rooms)) guild.rooms = {};
  guild.rooms = mergeDefaults(guild.rooms, defaults.rooms);
  if (!isPlainObject(guild.rooms.transferredOwners)) guild.rooms.transferredOwners = {};
  guild.rooms.transferredOwners = Object.fromEntries(Object.entries(guild.rooms.transferredOwners).filter(([, userId]) => typeof userId === 'string' && userId));

  if (!isPlainObject(guild.stats)) guild.stats = {};
  guild.stats = mergeDefaults(guild.stats, defaults.stats);
  if (!isPlainObject(guild.stats.days)) guild.stats.days = {};
  if (!isPlainObject(guild.stats.users)) guild.stats.users = {};
  for (const [userId, value] of Object.entries(guild.stats.users)) {
    if (!isPlainObject(value)) {
      delete guild.stats.users[userId];
      continue;
    }
    for (const key of ['messages', 'voiceMinutes', 'invites']) {
      if (!Number.isFinite(value[key]) || value[key] < 0) value[key] = 0;
    }
  }
  for (const [day, value] of Object.entries(guild.stats.days)) {
    if (!isPlainObject(value)) {
      delete guild.stats.days[day];
      continue;
    }
    for (const key of ['messages', 'joins', 'leaves', 'voiceMinutes']) {
      if (!Number.isFinite(value[key]) || value[key] < 0) value[key] = 0;
    }
  }
  if (typeof guild.stats.enabled !== 'boolean') guild.stats.enabled = defaults.stats.enabled;
  for (const key of ['messages', 'joins', 'leaves', 'voiceMinutes']) {
    if (!Number.isFinite(guild.stats[key]) || guild.stats[key] < 0) guild.stats[key] = defaults.stats[key];
  }

  if (!isPlainObject(guild.levels)) guild.levels = {};
  guild.levels = mergeDefaults(guild.levels, defaults.levels);
  if (typeof guild.levels.enabled !== 'boolean') guild.levels.enabled = defaults.levels.enabled;
  if (!Number.isInteger(guild.levels.xpPerMessage) || guild.levels.xpPerMessage < 1 || guild.levels.xpPerMessage > 100) guild.levels.xpPerMessage = defaults.levels.xpPerMessage;
  if (!Number.isInteger(guild.levels.cooldownSeconds) || guild.levels.cooldownSeconds < 5 || guild.levels.cooldownSeconds > 3600) guild.levels.cooldownSeconds = defaults.levels.cooldownSeconds;
  if (typeof guild.levels.announce !== 'boolean') guild.levels.announce = defaults.levels.announce;
  if (!isPlainObject(guild.levels.rewards)) guild.levels.rewards = {};
  for (const [level, roleId] of Object.entries(guild.levels.rewards)) {
    if (!/^[1-9]\d{0,2}$/.test(level) || !/^\d{5,25}$/.test(String(roleId))) delete guild.levels.rewards[level];
  }
  if (!isPlainObject(guild.levels.users)) guild.levels.users = {};
  for (const [userId, value] of Object.entries(guild.levels.users)) {
    if (!isPlainObject(value)) { delete guild.levels.users[userId]; continue; }
    if (!Number.isFinite(value.xp) || value.xp < 0) value.xp = 0;
    if (!Number.isInteger(value.level) || value.level < 0) value.level = 0;
    if (!Number.isInteger(value.messages) || value.messages < 0) value.messages = 0;
  }

  return guild;
}

function normalizeState(value) {
  const source = isPlainObject(value) ? value : createEmptyState();
  if (!isPlainObject(source.guilds)) source.guilds = {};
  for (const guildId of Object.keys(source.guilds)) source.guilds[guildId] = normalizeGuild(source.guilds[guildId]);
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
    state.guilds[guildId] = normalizeGuild(state.guilds[guildId]);
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

function recordStat(guildId, key, amount = 1, userId = null) {
  const stats = getGuild(guildId).stats;
  if (!stats.enabled) return;
  if (typeof stats[key] !== 'number') stats[key] = 0;
  stats[key] += amount;
  if (userId && ['messages', 'voiceMinutes', 'invites'].includes(key)) {
    if (!isPlainObject(stats.users[userId])) stats.users[userId] = { messages: 0, voiceMinutes: 0, invites: 0 };
    if (typeof stats.users[userId][key] !== 'number') stats.users[userId][key] = 0;
    stats.users[userId][key] += amount;
  }
  const day = new Date().toISOString().slice(0, 10);
  if (!stats.days[day] || typeof stats.days[day] !== 'object') stats.days[day] = { messages: 0, joins: 0, leaves: 0, voiceMinutes: 0 };
  if (typeof stats.days[day][key] !== 'number') stats.days[day][key] = 0;
  stats.days[day][key] += amount;
}

function getLeaderboard(guildId, key = 'messages', limit = 10) {
  if (!['messages', 'voiceMinutes', 'invites'].includes(key)) return [];
  const stats = getGuild(guildId).stats;
  const safeLimit = Math.min(10, Math.max(1, Number.isInteger(limit) ? limit : 10));
  return Object.entries(stats.users)
    .map(([userId, values]) => ({ userId, value: Number(values[key]) || 0 }))
    .filter((entry) => entry.value > 0)
    .sort((first, second) => second.value - first.value || first.userId.localeCompare(second.userId))
    .slice(0, safeLimit);
}

function getStats(guildId, days = 7) {
  const stats = getGuild(guildId).stats;
  const cutoff = Date.now() - (Math.max(1, days) * 24 * 60 * 60 * 1000);
  const recentDays = Object.entries(stats.days)
    .filter(([day]) => new Date(day + 'T00:00:00Z').getTime() >= cutoff)
    .sort(([first], [second]) => first.localeCompare(second));
  return { ...stats, days: recentDays };
}


function xpForLevel(level) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  return 100 * safeLevel + 25 * safeLevel * Math.max(0, safeLevel - 1);
}

function levelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  let level = 0;
  while (level < 1000 && xpForLevel(level + 1) <= safeXp) level += 1;
  return level;
}

function getLevelConfig(guildId) {
  return getGuild(guildId).levels;
}

function addLevelXp(guildId, userId, amount = 0) {
  const levels = getGuild(guildId).levels;
  if (!levels.enabled) return null;
  if (!isPlainObject(levels.users[userId])) levels.users[userId] = { xp: 0, level: 0, messages: 0 };
  const user = levels.users[userId];
  const previousLevel = Number.isInteger(user.level) ? user.level : levelFromXp(user.xp);
  user.xp = Math.max(0, Number(user.xp) || 0) + Math.max(0, Number(amount) || 0);
  user.messages = (Number.isInteger(user.messages) ? user.messages : 0) + 1;
  user.level = levelFromXp(user.xp);
  saveState();
  return { userId, xp: user.xp, level: user.level, messages: user.messages, previousLevel, leveledUp: user.level > previousLevel };
}

function getLevelUser(guildId, userId) {
  const levels = getGuild(guildId).levels;
  const user = levels.users[userId] || { xp: 0, level: 0, messages: 0 };
  return { userId, xp: Number(user.xp) || 0, level: Number(user.level) || 0, messages: Number(user.messages) || 0 };
}

function getLevelLeaderboard(guildId, limit = 10) {
  const levels = getGuild(guildId).levels;
  const safeLimit = Math.min(10, Math.max(1, Number.isInteger(limit) ? limit : 10));
  return Object.entries(levels.users)
    .map(([userId, value]) => ({ userId, xp: Number(value.xp) || 0, level: Number(value.level) || 0, messages: Number(value.messages) || 0 }))
    .filter((entry) => entry.xp > 0)
    .sort((first, second) => second.xp - first.xp || first.userId.localeCompare(second.userId))
    .slice(0, safeLimit);
}

function setLevelReward(guildId, level, roleId) {
  const safeLevel = Math.floor(Number(level));
  if (!Number.isInteger(safeLevel) || safeLevel < 1 || safeLevel > 1000 || !roleId) return false;
  const levels = getGuild(guildId).levels;
  levels.rewards[String(safeLevel)] = String(roleId);
  saveState();
  return true;
}

function removeLevelReward(guildId, level) {
  const levels = getGuild(guildId).levels;
  const key = String(Math.floor(Number(level)));
  const existed = Object.prototype.hasOwnProperty.call(levels.rewards, key);
  delete levels.rewards[key];
  saveState();
  return existed;
}

loadState();
saveState();

module.exports = { getGuild, updateGuildSection, addWarning, getWarnings, clearWarnings, recordStat, getLeaderboard, getStats, getLevelConfig, addLevelXp, getLevelUser, getLevelLeaderboard, setLevelReward, removeLevelReward, xpForLevel, saveState };
