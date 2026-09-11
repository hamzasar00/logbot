const { AuditLogEvent, EmbedBuilder, Colors } = require('discord.js');

const WINDOW_MS = 10_000;
const GUARD_RULES = new Map([
  [AuditLogEvent.ChannelDelete, { label: 'Kanal silme', threshold: 2 }],
  [AuditLogEvent.RoleDelete, { label: 'Rol silme', threshold: 2 }],
  [AuditLogEvent.MemberKick, { label: 'Üye kickleme', threshold: 3 }],
  [AuditLogEvent.MemberBanAdd, { label: 'Üye banlama', threshold: 3 }],
  [AuditLogEvent.WebhookCreate, { label: 'Webhook oluşturma', threshold: 1 }],
  [AuditLogEvent.BotAdd, { label: 'Bot ekleme', threshold: 1 }],
  [AuditLogEvent.MemberPrune, { label: 'Toplu üye temizleme', threshold: 1 }],
]);

const activityByKey = new Map();
const alertByKey = new Map();

function getWhitelistIds() {
  return new Set(
    String(process.env.GUARD_WHITELIST_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function getExecutorName(entry, executorId) {
  return entry.executor?.tag || entry.executor?.username || executorId || 'Bilinmeyen';
}

function getTargetName(entry) {
  return entry.target?.name || entry.target?.tag || entry.target?.username || entry.targetId || 'Bilinmeyen';
}

function initializeGuard({ client, sendLog }) {
  if (String(process.env.GUARD_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('Guard devre disi.');
    return;
  }

  client.on('guildAuditLogEntryCreate', async (entry, guild) => {
    const rule = GUARD_RULES.get(entry.action);
    if (!rule || !guild) {
      return;
    }

    const executorId = entry.executorId || entry.executor?.id;
    const whitelistIds = getWhitelistIds();
    if (!executorId || executorId === client.user?.id || executorId === guild.ownerId || whitelistIds.has(executorId)) {
      return;
    }

    const now = Date.now();
    const key = guild.id + ':' + executorId + ':' + entry.action;
    const recentActions = (activityByKey.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
    recentActions.push(now);
    activityByKey.set(key, recentActions);

    if (recentActions.length < rule.threshold) {
      return;
    }

    const lastAlertAt = alertByKey.get(key) || 0;
    if (now - lastAlertAt < WINDOW_MS) {
      return;
    }

    alertByKey.set(key, now);
    activityByKey.set(key, []);

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Guard Uyarısı')
      .setColor(Colors.Orange)
      .setDescription('Şüpheli yönetici işlemi tespit edildi. Guard bu sürümde yalnızca kayıt tutar; otomatik yaptırım uygulamaz.')
      .addFields(
        { name: '⚠️ İşlem', value: rule.label, inline: true },
        { name: '🔢 Eşik', value: String(rule.threshold) + ' işlem / 10 saniye', inline: true },
        { name: '👤 Uygulayan', value: getExecutorName(entry, executorId), inline: true },
        { name: '🎯 Hedef', value: getTargetName(entry), inline: true },
        { name: '📝 Sebep', value: entry.reason || 'Sebep belirtilmedi', inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false },
      );

    await sendLog(guild.id, 'moderation', embed).catch((error) => {
      console.error('Guard uyarısı loglanamadı:', error.message);
    });
  });
}

module.exports = { initializeGuard };
