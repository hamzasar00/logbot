const {
  Events,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');
const {
  getGuild,
  updateGuildSection,
  addWarning,
  getWarnings,
  clearWarnings,
  recordStat,
  getStats,
  saveState,
} = require('./v2-db');

const spamBuckets = new Map();
const voiceStarted = new Map();

function isInteraction(context) {
  return typeof context.isChatInputCommand === 'function' && context.isChatInputCommand();
}

function isManager(member) {
  return Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

async function respond(context, payload) {
  if (isInteraction(context)) {
    if (context.replied || context.deferred) return context.followUp(payload);
    return context.reply(payload);
  }
  const safePayload = { ...payload };
  delete safePayload.ephemeral;
  return context.reply(safePayload);
}

function guildOf(context) {
  return context.guild;
}

function targetOf(context) {
  return isInteraction(context)
    ? context.options.getUser('user')
    : context.mentions?.users?.first();
}

function channelOf(context) {
  return isInteraction(context)
    ? context.options.getChannel('kanal')
    : context.mentions?.channels?.first();
}

function roleOf(context) {
  return isInteraction(context)
    ? context.options.getRole('rol')
    : context.mentions?.roles?.first();
}

function argsOf(context) {
  return Array.isArray(context.args) ? context.args : [];
}

async function runV2Command(handler, context, label) {
  try {
    return await handler();
  } catch (error) {
    console.error('V2 ' + label + ' hatası:', error);
    if (isInteraction(context) && !context.replied && !context.deferred) {
      await context.reply({ content: '❌ Komut çalıştırılırken hata oluştu.', ephemeral: true }).catch(() => {});
    }
  }
}

async function memberOf(guild, userId) {
  return guild.members.cache.get(userId) || guild.members.fetch(userId).catch(() => null);
}

async function textChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

function formatMessage(text, member) {
  return String(text || '')
    .replaceAll('{user}', '<@' + member.id + '>')
    .replaceAll('{username}', member.user?.username || member.displayName || 'Üye')
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));
}

async function temporaryMessage(channel, content) {
  const sent = await channel.send({ content }).catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), 6000);
}

async function warningCommand(context, action) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  if (!isManager(context.member)) {
    return respond(context, { content: 'Bu işlem için Sunucuyu Yönet veya Yönetici yetkisi gerekir.', ephemeral: true });
  }
  const target = targetOf(context);
  if (!target) return respond(context, { content: 'Bir kullanıcı belirtmelisin.', ephemeral: true });
  if (action === 'list') {
    const warnings = getWarnings(guild.id, target.id);
    const text = warnings.length
      ? warnings.slice(-10).map((w, i) => (i + 1) + '. ' + w.reason + ' — ' + new Date(w.createdAt).toLocaleString('tr-TR')).join('\n')
      : 'Kayıtlı uyarı yok.';
    return respond(context, {
      embeds: [new EmbedBuilder().setTitle('⚠️ Uyarı Geçmişi').setDescription('<@' + target.id + '>\n' + text.slice(0, 3900)).setColor(0xF59E0B)],
      ephemeral: true,
    });
  }
  if (action === 'clear') {
    const removed = clearWarnings(guild.id, target.id);
    return respond(context, { content: '✅ ' + removed + ' uyarı temizlendi.', ephemeral: true });
  }
  const targetMember = await memberOf(guild, target.id);
  if (!targetMember) return respond(context, { content: 'Kullanıcı sunucuda bulunamadı.', ephemeral: true });
  const reason = isInteraction(context)
    ? context.options.getString('sebep')
    : argsOf(context).slice(1).join(' ') || 'Sebep belirtilmedi';
  const warning = addWarning(guild.id, target.id, context.user?.id || context.author?.id || 'system', reason);
  const config = getGuild(guild.id).moderation;
  const total = getWarnings(guild.id, target.id).length;
  if (total >= config.maxWarnings && targetMember.moderatable) {
    await targetMember.timeout(config.timeoutMinutes * 60 * 1000, 'Uyarı sınırına ulaşıldı').catch(() => {});
  }
  return respond(context, { content: '⚠️ <@' + target.id + '> uyarıldı. Toplam: ' + total + '. Sebep: ' + String(warning.reason).slice(0, 1800) });
}

async function filterCommand(context, action, suppliedWord) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  if (!isManager(context.member)) {
    return respond(context, { content: 'Bu işlem için Sunucuyu Yönet veya Yönetici yetkisi gerekir.', ephemeral: true });
  }
  const config = getGuild(guild.id).moderation;
  const normalizedAction = { link: 'links', invite: 'invites' }[action] || action;
  const filters = { ...config.filters };
  action = normalizedAction || 'durum';
  if (action === 'durum') {
    const lines = ['Moderasyon: ' + (config.enabled ? 'açık' : 'kapalı')];
    for (const key of ['spam', 'links', 'caps', 'invites']) lines.push(key + ': ' + (filters[key] ? 'açık' : 'kapalı'));
    lines.push('Yasaklı kelime sayısı: ' + filters.blockedWords.length);
    return respond(context, { content: lines.join('\n'), ephemeral: true });
  }
  if (action === 'ac' || action === 'kapat') {
    updateGuildSection(guild.id, 'moderation', { enabled: action === 'ac' });
    return respond(context, { content: '✅ Otomatik moderasyon ' + (action === 'ac' ? 'açıldı.' : 'kapatıldı.'), ephemeral: true });
  }
  if (action === 'kelime-ekle' || action === 'kelime-sil') {
    const word = suppliedWord || (isInteraction(context) ? context.options.getString('kelime') : argsOf(context)[1]);
    if (!word) return respond(context, { content: 'Bir kelime belirtmelisin.', ephemeral: true });
    const normalized = word.toLocaleLowerCase('tr-TR');
    const words = [...filters.blockedWords];
    const index = words.indexOf(normalized);
    if (action === 'kelime-ekle' && index === -1) words.push(normalized);
    if (action === 'kelime-sil' && index !== -1) words.splice(index, 1);
    updateGuildSection(guild.id, 'moderation', { filters: { ...filters, blockedWords: words } });
    return respond(context, { content: '✅ Yasaklı kelimeler güncellendi.', ephemeral: true });
  }
  if (!['spam', 'links', 'caps', 'invites'].includes(action)) {
    return respond(context, { content: 'Geçersiz filtre.', ephemeral: true });
  }
  const enabled = isInteraction(context)
    ? context.options.getString('durum') !== 'kapat'
    : argsOf(context)[1] !== 'kapat';
  updateGuildSection(guild.id, 'moderation', { filters: { ...filters, [action]: enabled } });
  return respond(context, { content: '✅ ' + action + ' filtresi ' + (enabled ? 'açıldı.' : 'kapatıldı.'), ephemeral: true });
}

async function applyModeration(message, sendLog) {
  if (!message.guild || message.author.bot || message.content.startsWith('.')) return;
  const config = getGuild(message.guild.id).moderation;
  if (!config.enabled || !message.member || isManager(message.member)) return;
  const content = message.content;
  const lower = content.toLocaleLowerCase('tr-TR');
  let reason = config.filters.blockedWords.some((word) => word && lower.includes(word)) ? 'yasaklı kelime' : null;
  if (!reason && config.filters.invites && /(discord\.gg\/|discord\.com\/invite\/)/i.test(content)) reason = 'Discord davet linki';
  if (!reason && config.filters.links && /https?:\/\//i.test(content)) reason = 'link';
  if (!reason && config.filters.caps) {
    const letters = content.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || [];
    const upper = content.match(/[A-ZÇĞİÖŞÜ]/g) || [];
    if (letters.length >= 10 && upper.length / letters.length >= 0.75) reason = 'aşırı büyük harf';
  }
  if (!reason && config.filters.spam) {
    const key = message.guild.id + ':' + message.author.id;
    const now = Date.now();
    const times = (spamBuckets.get(key) || []).filter((time) => now - time < 8000);
    times.push(now);
    spamBuckets.set(key, times);
    if (times.length >= 5) reason = 'spam/flood';
  }
  if (!reason) return;
  await message.delete().catch(() => {});
  const warning = addWarning(message.guild.id, message.author.id, message.client.user.id, 'Otomatik moderasyon: ' + reason);
  const total = getWarnings(message.guild.id, message.author.id).length;
  if (total >= config.maxWarnings && message.member.moderatable) {
    await message.member.timeout(config.timeoutMinutes * 60 * 1000, 'Otomatik uyarı sınırı').catch(() => {});
  }
  await temporaryMessage(message.channel, '⚠️ <@' + message.author.id + '> mesajı kaldırıldı: ' + reason + '. Uyarı: ' + total);
  await sendLog(message.guild.id, 'moderation', new EmbedBuilder()
    .setTitle('🛡️ Otomatik Moderasyon')
    .setDescription('<@' + message.author.id + '> mesajı kaldırıldı.')
    .addFields({ name: 'Sebep', value: reason }, { name: 'Uyarı ID', value: warning.id })
    .setColor(0xEF4444)).catch(() => {});
}

async function welcomeCommand(context) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  if (!isManager(context.member)) {
    return respond(context, { content: 'Bu işlem için Sunucuyu Yönet veya Yönetici yetkisi gerekir.', ephemeral: true });
  }
  const action = isInteraction(context) ? context.options.getString('eylem') : argsOf(context)[0] || 'durum';
  const config = getGuild(guild.id).welcome;
  if (action === 'durum') {
    return respond(context, { content: 'Hoş geldin: ' + (config.enabled ? 'açık' : 'kapalı') + '\nKanal: ' + (config.channelId ? '<#' + config.channelId + '>' : 'atanmamış') + '\nAyrılma: ' + (config.leaveEnabled ? 'açık' : 'kapalı') + '\nOtomatik rol: ' + (config.autoRoleId ? '<@&' + config.autoRoleId + '>' : 'atanmamış'), ephemeral: true });
  }
  if (action === 'kapat') updateGuildSection(guild.id, 'welcome', { enabled: false });
  else if (action === 'ac') {
    const channel = channelOf(context);
    if (!channel) return respond(context, { content: 'Bir metin kanalı seçmelisin.', ephemeral: true });
    const message = isInteraction(context) ? context.options.getString('mesaj') : argsOf(context).slice(2).join(' ');
    updateGuildSection(guild.id, 'welcome', { enabled: true, channelId: channel.id, message: message || config.message });
  } else if (action === 'ayril') {
    const channel = channelOf(context);
    if (!channel) return respond(context, { content: 'Bir metin kanalı seçmelisin.', ephemeral: true });
    const message = isInteraction(context) ? context.options.getString('mesaj') : argsOf(context).slice(2).join(' ');
    updateGuildSection(guild.id, 'welcome', { leaveEnabled: true, leaveChannelId: channel.id, leaveMessage: message || config.leaveMessage });
  } else if (action === 'ayril-kapat') updateGuildSection(guild.id, 'welcome', { leaveEnabled: false });
  else if (action === 'rol') {
    const role = roleOf(context);
    if (!role) return respond(context, { content: 'Bir rol seçmelisin.', ephemeral: true });
    updateGuildSection(guild.id, 'welcome', { autoRoleId: role.id });
  } else if (action === 'rol-kapat') updateGuildSection(guild.id, 'welcome', { autoRoleId: null });
  else return respond(context, { content: 'Kullanım: .hosgeldin ac #kanal mesaj | kapat | ayril #kanal mesaj | ayril-kapat | rol @rol | rol-kapat | durum', ephemeral: true });
  return respond(context, { content: '✅ Hoş geldin ayarları güncellendi.', ephemeral: true });
}

async function statsCommand(context) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const action = isInteraction(context) ? context.options.getString('eylem') || 'rapor' : argsOf(context)[0] || 'rapor';
  if (action === 'ac' || action === 'kapat') {
    if (!isManager(context.member)) return respond(context, { content: 'Bu işlem için Sunucuyu Yönet veya Yönetici yetkisi gerekir.', ephemeral: true });
    updateGuildSection(guild.id, 'stats', { enabled: action === 'ac' });
    return respond(context, { content: '✅ İstatistik toplama ' + (action === 'ac' ? 'açıldı.' : 'kapatıldı.'), ephemeral: true });
  }
  const config = getGuild(guild.id).stats;
  if (!config.enabled) return respond(context, { content: 'İstatistikler kapalı. Yönetici `.istatistik ac` komutuyla açabilir.', ephemeral: true });
  const days = isInteraction(context) ? context.options.getInteger('gun') || 7 : Math.min(30, Math.max(1, Number(argsOf(context)[0]) || 7));
  const stats = getStats(guild.id, days);
  const daily = stats.days.length ? stats.days.map(([day, value]) => day + ': ' + value.messages + ' mesaj, ' + value.joins + ' katılım, ' + value.leaves + ' ayrılma').join('\n') : 'Henüz günlük kayıt yok.';
  return respond(context, { embeds: [new EmbedBuilder().setTitle('📊 Sunucu İstatistikleri').setColor(0x3B82F6).addFields(
    { name: 'Toplam mesaj', value: String(stats.messages), inline: true },
    { name: 'Katılım', value: String(stats.joins), inline: true },
    { name: 'Ayrılma', value: String(stats.leaves), inline: true },
    { name: 'Ses dakikası', value: String(stats.voiceMinutes), inline: true },
    { name: 'Son ' + days + ' gün', value: daily.slice(0, 1024) }
  )] });
}

function ownedRoom(guild, userId) {
  const transferred = getGuild(guild.id).rooms.transferredOwners || {};
  return guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildVoice) return false;
    if (transferred[channel.id] === userId) return true;
    const owner = channel.permissionOverwrites.cache.get(userId);
    const everyone = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
    return Boolean(owner?.allow.has(PermissionsBitField.Flags.Connect) && everyone?.deny.has(PermissionsBitField.Flags.Connect));
  }) || null;
}

async function roomCommand(context, action) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const userId = context.user?.id || context.author.id;
  const room = ownedRoom(guild, userId);
  if (!room) return respond(context, { content: 'Sahibi olduğun aktif bir özel oda bulunamadı.', ephemeral: true });
  if (action === 'devret') {
    const target = targetOf(context);
    if (!target || target.bot) return respond(context, { content: 'Bir kullanıcı belirtmelisin.', ephemeral: true });
    if (!await memberOf(guild, target.id)) return respond(context, { content: 'Kullanıcı sunucuda bulunamadı.', ephemeral: true });
    const existingTargetRoom = ownedRoom(guild, target.id);
    if (existingTargetRoom && existingTargetRoom.id !== room.id) {
      return respond(context, { content: 'Bu kullanıcının zaten aktif bir özel odası var.', ephemeral: true });
    }
    await room.permissionOverwrites.edit(userId, { Connect: false, ViewChannel: false });
    await room.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true });
    const controlChannel = guild.channels.cache.find((channel) =>
      channel.type === ChannelType.GuildText && channel.topic === 'logbot-room:' + room.id
    );
    if (controlChannel) {
      await controlChannel.permissionOverwrites.edit(userId, {
        ViewChannel: false,
        SendMessages: false,
        ReadMessageHistory: false,
      });
      await controlChannel.permissionOverwrites.edit(target.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    }
    const baseName = room.name.replace(/ · .+$/, '');
    await room.setName(baseName + ' · ' + target.username).catch(() => {});
    const activeOwners = globalThis.roomOwnerMap;
    const activeRoomInfo = activeOwners?.get(room.id);
    if (activeRoomInfo) {
      activeRoomInfo.ownerId = target.id;
      activeRoomInfo.roomName = baseName;
      activeRoomInfo.controlChannelId = controlChannel?.id || activeRoomInfo.controlChannelId || null;
      activeOwners.set(room.id, activeRoomInfo);
    }
    const config = getGuild(guild.id).rooms;
    updateGuildSection(guild.id, 'rooms', { transferredOwners: { ...config.transferredOwners, [room.id]: target.id } });
    return respond(context, { content: '✅ Özel oda sahipliği <@' + target.id + '> kullanıcısına devredildi.', ephemeral: true });
  }
  if (action === 'kilitle') {
    const everyone = room.permissionOverwrites.cache.get(guild.roles.everyone.id);
    const locked = !everyone?.deny.has(PermissionsBitField.Flags.Connect);
    await room.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: locked ? false : true, ViewChannel: true });
    return respond(context, { content: locked ? '🔒 Oda kilitlendi.' : '🔓 Odanın kilidi açıldı.', ephemeral: true });
  }
  const limit = isInteraction(context) ? context.options.getInteger('limit') : Number(argsOf(context)[0]);
  if (!Number.isInteger(limit) || limit < 0 || limit > 99) return respond(context, { content: 'Kişi limiti 0 ile 99 arasında olmalı.', ephemeral: true });
  await room.setUserLimit(limit);
  return respond(context, { content: '✅ Oda kişi limiti güncellendi.', ephemeral: true });
}

const slashCommands = [
  { name: 'setup', description: 'Log ve oda sistemini hazırlar' },
  { name: 'log', description: 'Log kontrol panelini açar' },
  { name: 'oda', description: 'Özel oda menüsünü gösterir' },
  { name: 'roller', description: 'Rol seçim menüsünü gösterir' },
  { name: 'help', description: 'Yardım menüsünü gösterir' },
  { name: 'uyar', description: 'Kullanıcıya uyarı verir', options: [{ name: 'user', description: 'Uyarılacak kullanıcı', type: 6, required: true }, { name: 'sebep', description: 'Sebep', type: 3, required: true }] },
  { name: 'uyarilar', description: 'Uyarıları gösterir', options: [{ name: 'user', description: 'Kullanıcı', type: 6, required: true }] },
  { name: 'uyarisil', description: 'Uyarıları temizler', options: [{ name: 'user', description: 'Kullanıcı', type: 6, required: true }] },
  { name: 'uyari-sil', description: 'Uyarıları temizler', options: [{ name: 'user', description: 'Kullanıcı', type: 6, required: true }] },
  { name: 'filtre', description: 'Otomatik moderasyon ayarları', options: [{ name: 'eylem', description: 'İşlem', type: 3, required: true, choices: [{ name: 'durum', value: 'durum' }, { name: 'ac', value: 'ac' }, { name: 'kapat', value: 'kapat' }, { name: 'spam', value: 'spam' }, { name: 'link', value: 'links' }, { name: 'caps', value: 'caps' }, { name: 'invite', value: 'invites' }, { name: 'kelime-ekle', value: 'kelime-ekle' }, { name: 'kelime-sil', value: 'kelime-sil' }] }, { name: 'durum', description: 'ac veya kapat', type: 3 }, { name: 'kelime', description: 'Kelime', type: 3 }] },
  { name: 'hosgeldin', description: 'Hoş geldin ayarları', options: [{ name: 'eylem', description: 'İşlem', type: 3, required: true, choices: [{ name: 'durum', value: 'durum' }, { name: 'ac', value: 'ac' }, { name: 'kapat', value: 'kapat' }, { name: 'ayril', value: 'ayril' }, { name: 'ayril-kapat', value: 'ayril-kapat' }, { name: 'rol', value: 'rol' }, { name: 'rol-kapat', value: 'rol-kapat' }] }, { name: 'kanal', description: 'Metin kanalı', type: 7, channel_types: [0] }, { name: 'rol', description: 'Otomatik rol', type: 8 }, { name: 'mesaj', description: 'Şablon mesaj', type: 3 }] },
  { name: 'istatistik', description: 'Sunucu istatistikleri', options: [{ name: 'eylem', description: 'İşlem', type: 3, choices: [{ name: 'rapor', value: 'rapor' }, { name: 'ac', value: 'ac' }, { name: 'kapat', value: 'kapat' }] }, { name: 'gun', description: 'Gün sayısı', type: 4, min_value: 1, max_value: 30 }] },
  { name: 'oda-devret', description: 'Özel oda sahipliğini devreder', options: [{ name: 'user', description: 'Yeni sahip', type: 6, required: true }] },
  { name: 'oda-kilitle', description: 'Özel odayı kilitler veya açar' },
  { name: 'oda-limit', description: 'Özel oda limitini değiştirir', options: [{ name: 'limit', description: '0 sınırsızdır', type: 4, required: true, min_value: 0, max_value: 99 }] },
];

function initializeV2({ client, rest, sendLog, commandHandlers = {} }) {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    if (message.content.startsWith('.')) {
      const args = message.content.slice(1).trim().split(/\s+/);
      const command = (args.shift() || '').toLocaleLowerCase('tr-TR');
      const context = Object.create(message);
      context.args = args;
      if (['uyar', 'uyarı'].includes(command)) return runV2Command(() => warningCommand(context, 'add'), context, command);
      if (['uyarilar', 'uyarılar'].includes(command)) return runV2Command(() => warningCommand(context, 'list'), context, command);
      if (['uyarisil', 'uyari-sil', 'uyarı-sil'].includes(command)) return runV2Command(() => warningCommand(context, 'clear'), context, command);
      if (command === 'filtre') return runV2Command(() => filterCommand(context, args[0], args[1]), context, command);
      if (command === 'hosgeldin' || command === 'hoşgeldin') return runV2Command(() => welcomeCommand(context), context, command);
      if (command === 'istatistik') return runV2Command(() => statsCommand(context), context, command);
      if (command === 'oda-devret') return runV2Command(() => roomCommand(context, 'devret'), context, command);
      if (command === 'oda-kilitle') return runV2Command(() => roomCommand(context, 'kilitle'), context, command);
      if (command === 'oda-limit') return runV2Command(() => roomCommand(context, 'limit'), context, command);
    }
    recordStat(message.guild.id, 'messages');
    await applyModeration(message, sendLog).catch((error) => console.error('V2 moderasyon hatası:', error.message));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      const name = interaction.commandName;
      if (commandHandlers[name]) return await commandHandlers[name](interaction);
      if (name === 'uyar') return await warningCommand(interaction, 'add');
      if (name === 'uyarilar') return await warningCommand(interaction, 'list');
      if (name === 'uyarisil' || name === 'uyari-sil') return await warningCommand(interaction, 'clear');
      if (name === 'filtre') return await filterCommand(interaction, interaction.options.getString('eylem'), interaction.options.getString('kelime'));
      if (name === 'hosgeldin') return await welcomeCommand(interaction);
      if (name === 'istatistik') return await statsCommand(interaction);
      if (name === 'oda-devret') return await roomCommand(interaction, 'devret');
      if (name === 'oda-kilitle') return await roomCommand(interaction, 'kilitle');
      if (name === 'oda-limit') return await roomCommand(interaction, 'limit');
    } catch (error) {
      console.error('V2 slash komut hatası:', error);
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Komut çalıştırılırken hata oluştu.', ephemeral: true }).catch(() => {});
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const config = getGuild(member.guild.id);
    recordStat(member.guild.id, 'joins');
    if (member.user.bot && !config.welcome.includeBots) return;
    if (config.welcome.enabled && config.welcome.channelId) {
      const channel = textChannel(member.guild, config.welcome.channelId);
      if (channel) await channel.send({ content: formatMessage(config.welcome.message, member) }).catch((error) => console.error('Hoş geldin mesajı gönderilemedi:', error.message));
    }
    if (config.welcome.autoRoleId) await member.roles.add(config.welcome.autoRoleId).catch(() => {});
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const config = getGuild(member.guild.id);
    recordStat(member.guild.id, 'leaves');
    if (!config.welcome.leaveEnabled || !config.welcome.leaveChannelId) return;
    const channel = textChannel(member.guild, config.welcome.leaveChannelId);
    if (channel) await channel.send({ content: formatMessage(config.welcome.leaveMessage, member) }).catch((error) => console.error('Ayrılma mesajı gönderilemedi:', error.message));
  });

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const key = newState.guild.id + ':' + newState.id;
    if (!oldState.channelId && newState.channelId) voiceStarted.set(key, Date.now());
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const started = voiceStarted.get(key);
      if (started) recordStat(newState.guild.id, 'voiceMinutes', Math.max(1, Math.ceil((Date.now() - started) / 60000)));
      if (newState.channelId) voiceStarted.set(key, Date.now());
      else voiceStarted.delete(key);
    }
  });

  client.once(Events.ClientReady, async () => {
    for (const guild of client.guilds.cache.values()) {
      await rest.put('/applications/' + client.user.id + '/guilds/' + guild.id + '/commands', { body: slashCommands })
        .catch((error) => console.error('V2 slash komutları kaydedilemedi:', error.message));
    }
    console.log('V2 özellikleri hazır: moderasyon, hoş geldin, özel oda 2.0, istatistik ve slash komutları.');
  });

  setInterval(() => saveState(), 30000);
}

module.exports = { initializeV2 };