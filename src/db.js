const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbDirectory = path.join(__dirname, '..', 'data');
fs.mkdirSync(dbDirectory, { recursive: true });

const db = new Database(path.join(dbDirectory, 'bot.db'));

const LOG_GROUPS = Object.freeze({
  member: { key: 'member', label: 'Üye Log', channelName: 'uye-log', defaultEnabled: true },
  message: { key: 'message', label: 'Mesaj Log', channelName: 'mesaj-log', defaultEnabled: true },
  role: { key: 'role', label: 'Rol Log', channelName: 'rol-log', defaultEnabled: true },
  channel: { key: 'channel', label: 'Kanal Log', channelName: 'kanal-log', defaultEnabled: true },
  voice: { key: 'voice', label: 'Ses Log', channelName: 'ses-log', defaultEnabled: true },
  moderation: { key: 'moderation', label: 'Moderasyon Log', channelName: 'moderasyon-log', defaultEnabled: true },
  guild: { key: 'guild', label: 'Sunucu Log', channelName: 'sunucu-log', defaultEnabled: true },
});

function initDatabase() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_log_settings (
      guild_id TEXT NOT NULL,
      log_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, log_key)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_log_channels (
      guild_id TEXT NOT NULL,
      log_key TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, log_key)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_setup (
      guild_id TEXT PRIMARY KEY,
      main_category_id TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_category_ids (
      guild_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, category_name)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS guild_roles (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS role_menu_storage (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL
    )
  `).run();
}

function ensureGuildDefaults(guildId) {
  const existing = Object.keys(LOG_GROUPS);
  for (const key of existing) {
    const row = db.prepare('SELECT 1 FROM guild_log_settings WHERE guild_id = ? AND log_key = ?').get(guildId, key);
    if (!row) {
      db.prepare('INSERT INTO guild_log_settings (guild_id, log_key, enabled) VALUES (?, ?, ?)').run(guildId, key, LOG_GROUPS[key].defaultEnabled ? 1 : 0);
    }
  }
}

function setLogEnabled(guildId, logKey, enabled) {
  db.prepare('INSERT INTO guild_log_settings (guild_id, log_key, enabled) VALUES (?, ?, ?) ON CONFLICT(guild_id, log_key) DO UPDATE SET enabled = excluded.enabled').run(guildId, logKey, enabled ? 1 : 0);
}

function isLogEnabled(guildId, logKey) {
  const row = db.prepare('SELECT enabled FROM guild_log_settings WHERE guild_id = ? AND log_key = ?').get(guildId, logKey);
  if (!row) {
    ensureGuildDefaults(guildId);
    const fallback = db.prepare('SELECT enabled FROM guild_log_settings WHERE guild_id = ? AND log_key = ?').get(guildId, logKey);
    return fallback ? Boolean(fallback.enabled) : true;
  }
  return Boolean(row.enabled);
}

function saveLogChannel(guildId, logKey, channelId) {
  db.prepare('INSERT INTO guild_log_channels (guild_id, log_key, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, log_key) DO UPDATE SET channel_id = excluded.channel_id').run(guildId, logKey, channelId);
}

function getLogChannel(guildId, logKey) {
  const row = db.prepare('SELECT channel_id FROM guild_log_channels WHERE guild_id = ? AND log_key = ?').get(guildId, logKey);
  return row ? row.channel_id : null;
}

function saveMainCategoryId(guildId, categoryId) {
  db.prepare("INSERT INTO guild_setup (guild_id, main_category_id, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(guild_id) DO UPDATE SET main_category_id = excluded.main_category_id, updated_at = datetime('now')").run(guildId, categoryId);
}

function saveCategoryId(guildId, categoryName, categoryId) {
  db.prepare('INSERT INTO guild_category_ids (guild_id, category_name, category_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, category_name) DO UPDATE SET category_id = excluded.category_id').run(guildId, categoryName, categoryId);
}

function getMainCategoryId(guildId) {
  const row = db.prepare('SELECT main_category_id FROM guild_setup WHERE guild_id = ?').get(guildId);
  return row ? row.main_category_id : null;
}

function getCategoryId(guildId, categoryName) {
  const row = db.prepare('SELECT category_id FROM guild_category_ids WHERE guild_id = ? AND category_name = ?').get(guildId, categoryName);
  return row ? row.category_id : null;
}

function getLogDefinitions() {
  return { ...LOG_GROUPS };
}

function addRoleToMenu(guildId, roleId, emoji) {
  db.prepare('INSERT INTO guild_roles (guild_id, role_id, emoji) VALUES (?, ?, ?) ON CONFLICT(guild_id, role_id) DO UPDATE SET emoji = excluded.emoji').run(guildId, roleId, emoji);
}

function removeRoleFromMenu(guildId, roleId) {
  db.prepare('DELETE FROM guild_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}

function getMenuRoles(guildId) {
  const rows = db.prepare('SELECT role_id, emoji FROM guild_roles WHERE guild_id = ? ORDER BY role_id').all(guildId);
  return rows || [];
}

function getRoleEmoji(guildId, roleId) {
  const row = db.prepare('SELECT emoji FROM guild_roles WHERE guild_id = ? AND role_id = ?').get(guildId, roleId);
  return row ? row.emoji : null;
}

function saveRoleMenuMessage(guildId, channelId, messageId) {
  db.prepare('INSERT INTO role_menu_storage (guild_id, channel_id, message_id) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id').run(guildId, channelId, messageId);
}

function getRoleMenuMessage(guildId) {
  const row = db.prepare('SELECT channel_id, message_id FROM role_menu_storage WHERE guild_id = ?').get(guildId);
  return row ? { channelId: row.channel_id, messageId: row.message_id } : null;
}

initDatabase();

module.exports = {
  initDatabase,
  ensureGuildDefaults,
  getLogDefinitions,
  setLogEnabled,
  isLogEnabled,
  saveLogChannel,
  getLogChannel,
  saveMainCategoryId,
  saveCategoryId,
  getMainCategoryId,
  getCategoryId,
  LOG_GROUPS,
  addRoleToMenu,
  removeRoleFromMenu,
  getMenuRoles,
  getRoleEmoji,
  saveRoleMenuMessage,
  getRoleMenuMessage,
};
