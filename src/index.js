const { Client, GatewayIntentBits, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, REST, Routes, ChannelSelectMenuBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, AuditLogEvent, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } = require('discord.js');
const { config } = require('dotenv');
config();

const discordToken = process.env.DISCORD_TOKEN?.trim();
if (!discordToken || discordToken === 'your_discord_bot_token_here') {
  console.error('DISCORD_TOKEN bulunamadı. Proje klasöründeki .env dosyasını doldurun.');
  process.exit(1);
}

const {
  getLogDefinitions,
  ensureGuildDefaults,
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
  saveBoostSetting,
  getBoostSetting,
} = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
});

const PREFIX = '.';

const ROLE_MENU_GROUPS = Object.freeze([
  { id: 'event', emoji: '🎉', label: 'Etkinlik Rolleri Seç' },
  { id: 'color', emoji: '🎨', label: 'Renk Rolleri Seç' },
  { id: 'zodiac', emoji: '⭐', label: 'Burç Rolleri Seç' },
  { id: 'game', emoji: '🎮', label: 'Oyun Rolleri Seç' },
  { id: 'team', emoji: '⚽', label: 'Takım Rolleri Seç' },
]);

const ROLE_GROUP_ALIASES = Object.freeze({
  etkinlik: 'event', event: 'event',
  renk: 'color', color: 'color',
  burç: 'zodiac', burc: 'zodiac', zodiac: 'zodiac',
  oyun: 'game', game: 'game',
  takım: 'team', takim: 'team', team: 'team',
  genel: 'general', diğer: 'general', diger: 'general', general: 'general',
});

const ROLE_GROUP_EMOJIS = Object.freeze({
  event: '🎉',
  color: '🎨',
  zodiac: '⭐',
  game: '🎮',
  team: '⚽',
  general: '🎭',
});

function normalizeRoleGroup(value) {
  const key = String(value || '').trim().toLocaleLowerCase('tr-TR');
  return ROLE_GROUP_ALIASES[key] || 'general';
}
const LOG_DEFINITIONS = getLogDefinitions();
const rest = new REST({ version: '10' }).setToken(discordToken);
const inviteSnapshots = new Map();
const inviteTotals = new Map();
const inFlightGuildTasks = new Map();

function runGuildTaskOnce(taskKey, task) {
  const activeTask = inFlightGuildTasks.get(taskKey);
  if (activeTask) {
    return activeTask;
  }

  const currentTask = Promise.resolve().then(task);
  inFlightGuildTasks.set(taskKey, currentTask);
  currentTask.then(
    () => { if (inFlightGuildTasks.get(taskKey) === currentTask) inFlightGuildTasks.delete(taskKey); },
    () => { if (inFlightGuildTasks.get(taskKey) === currentTask) inFlightGuildTasks.delete(taskKey); }
  );
  return currentTask;
}

function getGuildInviteTotals(guildId) {
  if (!inviteTotals.has(guildId)) {
    inviteTotals.set(guildId, new Map());
  }

  return inviteTotals.get(guildId);
}

async function updateGuildInviteSnapshot(guild) {
  if (!guild) {
    return;
  }

  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) {
    return;
  }

  const snapshot = new Map();
  for (const invite of invites.values()) {
    snapshot.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviterId ?? null,
    });
  }

  inviteSnapshots.set(guild.id, snapshot);
}

async function getInviteJoinInfo(member) {
  try {
    const guild = member.guild;
    const currentInvites = await guild.invites.fetch().catch(() => null);
    const previousSnapshot = inviteSnapshots.get(guild.id) ?? new Map();

    if (!currentInvites) {
      return { inviter: 'Bilinmeyen', totalInvites: 0 };
    }

    let matchedInvite = null;

    for (const invite of currentInvites.values()) {
      const previous = previousSnapshot.get(invite.code);
      const previousUses = previous?.uses ?? 0;
      const currentUses = invite.uses ?? 0;

      if (currentUses > previousUses) {
        matchedInvite = invite;
        break;
      }
    }

    if (!matchedInvite) {
      return { inviter: 'Bilinmeyen', totalInvites: 0 };
    }

    const inviterId = matchedInvite.inviterId ?? null;
    const totals = getGuildInviteTotals(guild.id);
    const total = inviterId ? (totals.get(inviterId) ?? 0) + 1 : 0;

    if (inviterId) {
      totals.set(inviterId, total);
    }

    await updateGuildInviteSnapshot(guild);

    return {
      inviter: inviterId ? `<@${inviterId}>` : 'Bilinmeyen',
      totalInvites: total,
    };
  } catch (error) {
    return { inviter: 'Bilinmeyen', totalInvites: 0 };
  }
}

async function deleteOldDiscordCommands() {
  const clientId = process.env.CLIENT_ID || client.user?.id;
  if (!clientId) {
    console.log('CLIENT_ID bulunamadığı için eski slash komutları silinemedi.');
    return;
  }

  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), { body: [] });
      console.log('Sunucu bazlı eski slash komutları silindi.');
    }

    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('Global eski slash komutları silindi.');
  } catch (error) {
    console.error('Eski slash komutları silinemedi:', error.message);
  }
}

function formatChannelValue(guild, channelId) {
  if (!channelId) {
    return 'Atanmamış';
  }

  const channel = guild.channels.cache.get(channelId) ?? null;
  return channel ? `<#${channel.id}>` : `Kanala erişilemedi (${channelId})`;
}

function buildLogPanel(guildId) {
  const guild = client.guilds.cache.get(guildId);
  const embed = new EmbedBuilder()
    .setTitle('📋 Log Kontrol Paneli')
    .setDescription('Her log türü bağımsızdır. Açık/kapalı ve kanal seçimi ayrı ayrı çalışır.')
    .setColor(Colors.Blurple);

  for (const definition of Object.values(LOG_DEFINITIONS)) {
    const enabled = isLogEnabled(guildId, definition.key);
    const assignedChannel = getLogChannel(guildId, definition.key);
    embed.addFields({
      name: `${enabled ? '🟢' : '⚪'} ${definition.label}`,
      value: `Durum: ${enabled ? 'AÇIK' : 'KAPALI'}\nKanal: ${formatChannelValue(guild, assignedChannel)}`,
      inline: false,
    });
  }

  return embed;
}

function createToggleButtons(guildId) {
  const rows = [];
  const logKeys = Object.keys(LOG_DEFINITIONS);

  for (let index = 0; index < logKeys.length; index += 5) {
    const chunk = logKeys.slice(index, index + 5);
    const row = new ActionRowBuilder();

    for (const logKey of chunk) {
      const definition = LOG_DEFINITIONS[logKey];
      const enabled = isLogEnabled(guildId, definition.key);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`toggle:${definition.key}`)
          .setLabel(`${enabled ? '🟢' : '⚪'} ${definition.label}`)
          .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }

    rows.push(row);
  }

  return rows;
}

function createChannelSelectionMenus() {
  const rows = [];
  const logKeys = Object.keys(LOG_DEFINITIONS);

  for (const logKey of logKeys) {
    const definition = LOG_DEFINITIONS[logKey];
    const row = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`channel-select:${definition.key}`)
        .setPlaceholder(`${definition.label} kanalını seç`)
        .setMinValues(0)
        .setMaxValues(1)
    );
    rows.push(row);
  }

  return rows;
}

function truncateText(value, maxLength = 1000) {
  if (!value) return 'Belirtilmedi';
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

async function sendLog(guildId, logGroupKey, embed) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild || !isLogEnabled(guildId, logGroupKey)) {
    return;
  }

  const channelId = getLogChannel(guildId, logGroupKey);
  if (!channelId) {
    return;
  }

  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased()) {
    return;
  }

  await channel.send({ embeds: [embed] });
}

function buildBoostNotificationEmbed(member) {
  const title = getBoostSetting(member.guild.id, 'title') || 'Thank You Buddy';
  const message = getBoostSetting(member.guild.id, 'message') || 'Welcome To Real CLR LEAK\nLEAK Buddy';
  const gifUrl = getBoostSetting(member.guild.id, 'gif_url');
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setAuthor({ name: member.user.username, iconURL: avatarUrl })
    .setTitle(title)
    .setDescription('<@' + member.user.id + '> ' + message)
    .setThumbnail(avatarUrl)
    .setTimestamp();

  if (gifUrl) {
    embed.setImage(gifUrl);
  }

  return embed;
}

function hasManageBoostPermission(message) {
  return message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
    message.member?.permissions?.has(PermissionsBitField.Flags.ManageChannels);
}

async function handleBoostChannelCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const channel = message.mentions.channels.first();
  if (!channel || !channel.isTextBased()) {
    await message.reply('Kullanım: .boost-kanal #kanal');
    return;
  }

  saveLogChannel(message.guild.id, 'boost', channel.id);
  await message.reply('✅ Boost bildirim kanalı ' + channel + ' olarak ayarlandı.');
}

async function handleBoostGifCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const firstArg = args[0]?.toLocaleLowerCase('tr-TR');
  if (firstArg === 'kaldır' || firstArg === 'kaldir') {
    saveBoostSetting(message.guild.id, 'gif_url', null);
    await message.reply('✅ Boost GIF bağlantısı kaldırıldı.');
    return;
  }

  const gifUrl = args[0] || message.attachments.first()?.url;
  if (!gifUrl) {
    await message.reply('Kullanım: .boost-gif https://... veya GIF dosyasını mesaja ekle.');
    return;
  }

  try {
    const parsedUrl = new URL(gifUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('invalid protocol');
  } catch {
    await message.reply('❌ Geçerli bir HTTP/HTTPS GIF bağlantısı veya dosyası kullan.');
    return;
  }

  saveBoostSetting(message.guild.id, 'gif_url', gifUrl);
  await message.reply('✅ Boost GIF bağlantısı kaydedildi.');
}

async function handleBoostTestCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu test için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const channelId = getLogChannel(message.guild.id, 'boost');
  if (!channelId) {
    await message.reply('❌ Önce .boost-kanal #kanal ile boost kanalını ayarla.');
    return;
  }

  const channel = message.guild.channels.cache.get(channelId) ||
    await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    await message.reply('❌ Kayıtlı boost kanalı bulunamadı. .boost-kanal #kanal ile tekrar ayarla.');
    return;
  }

  try {
    await channel.send({ embeds: [buildBoostNotificationEmbed(message.member)] });
    await message.reply('✅ Test boost bildirimi ' + channel + ' kanalına gönderildi.');
  } catch (error) {
    console.error('Boost test gönderme hatası:', error);
    await message.reply('❌ Test bildirimi gönderilemedi. Botun kanalda Mesaj Gönder ve Embed Links izinlerini kontrol et.');
  }
}

async function handleBoostTitleCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }
  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const title = args.join(' ').trim();
  if (!title) {
    await message.reply('Kullanım: .boost-baslik Thank You Buddy');
    return;
  }

  saveBoostSetting(message.guild.id, 'title', title.slice(0, 256));
  await message.reply('✅ Boost başlığı kaydedildi.');
}

async function handleBoostMessageCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }
  if (!hasManageBoostPermission(message)) {
    await message.reply('❌ Bu ayar için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.');
    return;
  }

  const text = args.join(' ').trim();
  if (!text) {
    await message.reply('Kullanım: .boost-mesaj Welcome To Real CLR LEAK | LEAK Buddy');
    return;
  }

  saveBoostSetting(message.guild.id, 'message', text.replace(/\s*\|\s*/g, '\n').slice(0, 4096));
  await message.reply('✅ Boost mesajı kaydedildi.');
}

async function getAuditLogInfo(guild, targetId, eventTypes) {
  if (!guild || !targetId || !eventTypes) {
    return { executor: 'Bilinmeyen', reason: 'Sebep belirtilmedi' };
  }

  const typeList = Array.isArray(eventTypes) ? eventTypes : [eventTypes];

  for (const eventType of typeList) {
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: eventType, limit: 10 });
      const entry = auditLogs.entries.find((item) => item.target && item.target.id === targetId);

      if (entry) {
        return {
          executor: entry.executor ? `<@${entry.executor.id}>` : 'Bilinmeyen',
          reason: entry.reason || 'Sebep belirtilmedi',
        };
      }
    } catch (error) {
      continue;
    }
  }

  return { executor: 'Bilinmeyen', reason: 'Sebep belirtilmedi' };
}

async function ensureSetupInternal(guild) {
  if (!guild) {
    return;
  }

  ensureGuildDefaults(guild.id);

  const mainCategoryName = 'LOGLAR';
  let mainCategory = null;
  const savedMainCategoryId = getMainCategoryId(guild.id);
  const savedMainCategory = savedMainCategoryId ? guild.channels.cache.get(savedMainCategoryId) : null;

  if (savedMainCategory?.type === ChannelType.GuildCategory) {
    mainCategory = savedMainCategory;
  }

  if (!mainCategory) {
    mainCategory = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === mainCategoryName
    );
  }

  if (!mainCategory) {
    mainCategory = await guild.channels.create({
      name: mainCategoryName,
      type: ChannelType.GuildCategory,
      reason: 'Ana log kategorisi oluşturuluyor.',
    });
  }

  saveMainCategoryId(guild.id, mainCategory.id);

  for (const group of Object.values(LOG_GROUPS)) {
    let channel = null;
    const savedChannelId = getLogChannel(guild.id, group.key);
    const savedChannel = savedChannelId ? guild.channels.cache.get(savedChannelId) : null;

    if (savedChannel?.type === ChannelType.GuildText) {
      channel = savedChannel;
    }

    if (!channel) {
      channel = guild.channels.cache.find(
        (item) => item.parentId === mainCategory.id && item.name === group.channelName && item.type === ChannelType.GuildText
      );
    }

    if (!channel) {
      channel = await guild.channels.create({
        name: group.channelName,
        type: ChannelType.GuildText,
        parent: mainCategory.id,
        reason: `${group.label} kanalı oluşturuluyor.`,
      });
    }

    saveLogChannel(guild.id, group.key, channel.id);
  }
}

async function ensureSetup(guild) {
  if (!guild) return;
  return runGuildTaskOnce(`setup:${guild.id}`, () => ensureSetupInternal(guild));
}

async function handleSetupCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  await ensureSetup(message.guild);
  await ensureRoomMenu(message.guild);

  const embed = new EmbedBuilder()
    .setTitle('✅ Log Sistemi Ayarlandı')
    .setDescription('Tek kategori ve 8 log kanalı hazırlandı. Oda oluşturma menüsü de hazır.')
    .setColor(Colors.Green)
    .addFields({
      name: '📁 Ana Kategori',
      value: 'LOGLAR',
      inline: false,
    });

  await message.reply({ embeds: [embed] });
}

async function handleLogCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  const embed = buildLogPanel(message.guild.id);
  const rows = [
    ...createToggleButtons(message.guild.id),
    ...createChannelSelectionMenus(),
  ];

  await message.reply({ embeds: [embed], components: rows });
}

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('🆘 Detaylı Yardım')
    .setDescription('Bu bot; sunucu loglarını, boost bildirimlerini, rol seçimlerini ve özel ses odalarını yönetir. Aşağıdaki komutlar nokta (.) prefixi ile kullanılır.')
    .setColor(Colors.Blurple)
    .addFields(
      {
        name: '🚀 Hızlı Başlangıç',
        value: '1. .setup yaz ve temel kanalları oluştur.\n2. .log ile log panelini aç.\n3. .boost-kanal #kanal ile boost kanalını seç.\n4. .roller ile rol menüsünü hazırla.',
        inline: false,
      },
      {
        name: '📋 .setup',
        value: 'LOGLAR kategorisini ve uye-log, mesaj-log, rol-log, kanal-log, ses-log, moderasyon-log, sunucu-log ve boost-log kanallarını hazırlar. Oda ve rol menüsü altyapısını da kontrol eder.',
        inline: false,
      },
      {
        name: '📊 .log',
        value: 'Log kontrol panelini açar. Her log türünü ayrı ayrı açıp kapatabilir ve kanalını seçim menüsünden değiştirebilirsin. Log türleri: üye, mesaj, rol, kanal, ses, moderasyon, sunucu ve boost.',
        inline: false,
      },
      {
        name: '🎁 BOOST BİLDİRİMLERİ',
        value: 'Boost geldiğinde seçtiğin kanala kırmızı kenarlı embed, boost yapan kişinin avatarı, başlık, mesaj ve GIF gönderilir.',
        inline: false,
      },
      {
        name: '.boost-kanal #kanal',
        value: 'Boost bildirimlerinin gönderileceği kanalı seçer. Örnek: .boost-kanal #boost\nGereken izin: Sunucuyu Yönet veya Kanalları Yönet.',
        inline: false,
      },
      {
        name: '.boost-gif bağlantı',
        value: 'Boost embedinde gösterilecek GIF bağlantısını kaydeder. Direkt GIF bağlantısı kullan veya GIF dosyasını mesaja ekle. Kaldırmak için: .boost-gif kaldır',
        inline: false,
      },
      {
        name: '.boost-test',
        value: 'Mevcut boost ayarlarıyla test bildirimi gönderir; gerçek boost gerekmez.',
        inline: false,
      },
      {
        name: '.boost-baslik metin',
        value: 'Boost embed başlığını değiştirir. Örnek: .boost-baslik Thank You Buddy',
        inline: false,
      },
      {
        name: '.boost-mesaj metin',
        value: 'Boost embed açıklamasını değiştirir. | işareti yeni satır oluşturur. Örnek: .boost-mesaj Welcome To Real CLR LEAK | LEAK Buddy',
        inline: false,
      },
      {
        name: '👥 ROL MENÜSÜ',
        value: 'Üyeler menüdeki seçimlerden rol alabilir. Menü üzerinden rol kaldırma sistemi yoktur; seçim sadece rol verir.',
        inline: false,
      },
      {
        name: '.roller-ekle @rol kategori',
        value: 'Rolü seçim menüsüne ekler. Emoji otomatik gelir. Kategoriler: etkinlik, renk, burç, oyun, takım. Örnek: .roller-ekle @Oyuncu oyun\nKısa kullanım: .rol-ekle @Oyuncu oyun',
        inline: false,
      },
      {
        name: '.roller',
        value: 'Rol seçim menüsünü gönderir veya mevcut rol-menusu kanalını günceller. Üyeler dropdown üzerinden yalnızca rol alabilir.',
        inline: false,
      },
      {
        name: '.roller-menu',
        value: 'Rol menüsü kanalını hazırlar ve yeniler. Menü kanalı kategori olmadan rol-menusu adıyla kullanılır.',
        inline: false,
      },
      {
        name: '.roller-sil @rol',
        value: 'Belirtilen rolü seçim menüsünden çıkarır. Rolün kendisini sunucudan silmez. Gereken izin: Rolleri Yönet.',
        inline: false,
      },
      {
        name: '🎧 SES ODASI',
        value: 'Özel ses odaları üyelerin kendi odalarını oluşturmasına izin verir. Oda sahibi ayrıldığında oda otomatik kapatılır.',
        inline: false,
      },
      {
        name: '.oda',
        value: 'Oda oluşturma panelini hazırlar. Üye paneldeki butona basarak kendi özel ses odasını açabilir; oda sahibi kullanıcı seçme menüleriyle erişim verebilir veya kaldırabilir.',
        inline: false,
      },
      {
        name: '🛡️ MODERASYON',
        value: 'Üyeleri uyarma ve otomatik filtreleri yönetme komutlarıdır. Yönetici veya Sunucuyu Yönet yetkisi gerekir.\n\n.uyar @kullanıcı [sebep] — Kullanıcıya uyarı verir.\n\n.uyarilar @kullanıcı / .uyarılar @kullanıcı — Uyarı geçmişindeki son kayıtları gösterir.\n\n.uyarisil @kullanıcı / .uyari-sil @kullanıcı — Kullanıcının uyarılarını temizler.\n\n.filtre durum — Moderasyon ve spam, link, büyük harf, davet filtrelerinin durumunu gösterir.\n.filtre ac | kapat — Otomatik moderasyonu açar veya kapatır.\n.filtre spam|link|caps|invite ac|kapat — Tek bir filtreyi açar/kapatır.\n.filtre kelime-ekle <kelime> / kelime-sil <kelime> — Yasaklı kelime listesine ekler veya çıkarır.',
        inline: false,
      },
      {
        name: '👋 HOŞ GELDİN & AYRILMA',
        value: '.hosgeldin durum — Hoş geldin, ayrılma ve otomatik rol ayarlarını gösterir.\n.hosgeldin ac #kanal [mesaj] — Katılan üyelere mesaj gönderimini açar.\n.hosgeldin kapat — Hoş geldin mesajlarını kapatır.\n.hosgeldin ayril #kanal [mesaj] — Ayrılan üyeler için mesaj açar.\n.hosgeldin ayril-kapat — Ayrılma mesajlarını kapatır.\n.hosgeldin rol @rol — Yeni üyeye otomatik verilecek rolü ayarlar.\n.hosgeldin rol-kapat — Otomatik rolü kaldırır.\n\nMesaj şablonları: {user}, {username}, {server}, {count}.',
        inline: false,
      },
      {
        name: '📈 İSTATİSTİK & LEADERBOARD',
        value: '.istatistik durum — İstatistiklerin açık/kapalı durumunu ve kayıtları gösterir.\n.istatistik ac | kapat — Mesaj, katılım, ayrılma, ses ve davet takibini açar/kapatır.\n.istatistik [gün] — Son 1-30 günün raporunu gösterir.\n\n.leaderboard metin|ses|davet [limit] — En fazla 10 kişilik sıralama gösterir.\n.leaderboard kur #kanal — Sabit leaderboard panelini kurar ve otomatik yenilemeyi açar.\n.leaderboard yenile — Paneli hemen yeniler.\n.leaderboard kapat — Otomatik yenilemeyi kapatır; panel silinmez.',
        inline: false,
      },
      {
        name: '🎲 EKONOMİ & OYUN',
        value: '.bakiye / .balance / .param — Çip bakiyeni gösterir.\n.gunluk / .günlük / .daily — 24 saatte bir günlük çip bonusu verir.\n.blackjack [bahis] / .bj [bahis] — Çip bahisli Blackjack başlatır. Bahis 10-1.000.000 çip arasında olmalıdır; oyun butonlarla oynanır.',
        inline: false,
      },
      {
        name: '🎖️ SEVİYE SİSTEMİ',
        value: '.seviye — Seviye, XP ve mesaj profilini gösterir. Başka kullanıcı için: .seviye @kullanıcı.\n.seviye ac | kapat — XP kazanımını açar/kapatır.\n.seviye sıralama [limit] — Seviye sıralamasını gösterir.\n.seviye ayar xp 15 — Mesaj başına XP miktarını ayarlar.\n.seviye ayar cooldown 60 — XP kazanma bekleme süresini saniye olarak ayarlar (5-3600).\n.seviye ayar duyuru #kanal — Seviye atlama duyuru kanalını ayarlar; kanal verilmezse duyuruyu kapatır.\n.seviye ödül 5 @rol — 5. seviyeye ulaşana rol verir.\n.seviye ödül-sil 5 — Seviye ödülünü kaldırır.',
        inline: false,
      },
      {
        name: '🎧 ÖZEL ODA YÖNETİMİ',
        value: '.oda-devret @kullanıcı — Sahibi olduğun özel odanın sahipliğini devreder.\n.oda-kilitle — Özel odayı kilitler veya kilidini açar.\n.oda-limit <0-99> — Özel odanın kişi sınırını değiştirir; 0 sınırsızdır.\n\nBu komutlar yalnızca aktif özel odanın sahibi tarafından kullanılabilir.',
        inline: false,
      },
      {
        name: '🔐 YETKİLER',
        value: 'Boost ayarları: Sunucuyu Yönet veya Kanalları Yönet.\nRol ekleme/silme: Rolleri Yönet.\nBot: Mesaj Gönder, Embedleri Kullan, Kanalları Yönet ve rol verecekse bot rolü hedef rollerin üstünde olmalı.',
        inline: false,
      },
      {
        name: '🧾 LOG DETAYLARI',
        value: 'Üye: giriş, çıkış ve profil değişiklikleri. Mesaj: silme ve düzenleme. Rol: rol verme/alma. Kanal: oluşturma, silme ve düzenleme. Ses: giriş, çıkış ve taşıma. Moderasyon: timeout ve ban işlemleri. Sunucu: sunucu ayarları. Boost: yeni boost bildirimleri.',
        inline: false,
      },
      {
        name: 'ℹ️ KULLANIM NOTLARI',
        value: 'Komutlar yalnızca sunucu içinde çalışır. Prefix: .\nYardım kısayolları: .help, .yardım, .yardim\nEski ilişki kategorisindeki roller Diğer kategorisine alınır. Ayarlar data/bot-data.json dosyasında saklanır.',
        inline: false,
      },
    )
    .setFooter({ text: 'Detaylı komut rehberi' })
    .setTimestamp();
}

function buildRoomMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('🎧 Özel Oda Oluşturma')
    .setDescription('Aşağıdaki butona basarak kendi ses odanı oluşturabilir ve ismini / kapasitesini ayarlayabilirsin.')
    .setColor(Colors.Green)
    .addFields(
      { name: '📌 Nasıl çalışır?', value: 'Butona basarsan bir modal açılır. Oda adını ve kişi limitini yazarsın. Bot sana özel bir ses odası hazırlar.', inline: false },
      { name: '🔒 Güvenlik', value: 'Oda sadece senin erişiminle açılır ve oluşturucuya özel olarak ayarlanır.', inline: false }
    );
}

function buildRoleMenuContent() {
  return [
    '📣 Sunucuda etiket atıp rahatsızlık vermemek için @everyone ve @here kullanmayınız.',
    'o yüzden çekiliş ve etkinlik katılımcısı rollerinizi almayı unutmayın.',
    '',
    '• Etkinlik Katılımcısı: Sunucuda düzenlenen tüm etkinliklere katılmak için.',
    '• Çekiliş Katılımcısı: Sunucuda düzenlenen tüm çekilişlere katılmak için.',
    '',
    '> **Not:** Renk rollerini alabilmek için "Booster veya Family" rolleri gerekmektedir.',
  ].join('\n');
}

const ROLE_MENU_PLACEHOLDERS = Object.freeze({
  event: '🎉 | Etkinlik Rolleri Seçin',
  color: '🎨 | Renk Rolleri Seçin...',
  zodiac: '⭐ | Burç Rolleri Seçin...',
  game: '🎮 | Oyun Rolleri Seçin',
  team: '⚽ | Takım Rolleri Seçin...',
  general: '🎭 | Diğer Rolleri Seçin...',
});

function getRoleMenuGroups(guildId) {
  const groups = [...ROLE_MENU_GROUPS];
  if (getMenuRoles(guildId).some((role) => role.group === 'general')) {
    groups.push({ id: 'general', emoji: '🎭', label: 'Diğer Rolleri Seç' });
  }
  return groups;
}

function buildRoleSelectRow(guildId, group) {
  const roles = getGroupRoles(guildId, group.id);
  const options = roles
    .map(({ role_id }) => role_id)
    .map((roleId) => client.guilds.cache.get(guildId)?.roles.cache.get(roleId))
    .filter((role) => role && !role.managed)
    .map((role) => ({
      label: role.name.slice(0, 100),
      value: role.id,
      description: 'Rolü almak veya kaldırmak için seç',
    }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('role-select:' + group.id)
    .setPlaceholder(ROLE_MENU_PLACEHOLDERS[group.id] || (group.emoji + ' | ' + group.label))
    .setMinValues(1)
    .setMaxValues(Math.max(options.length, 1));

  if (options.length > 0) {
    select.addOptions(options);
  } else {
    select
      .setDisabled(true)
      .addOptions({
        label: 'Bu kategoride henüz rol yok',
        value: 'empty:' + group.id,
      });
  }

  return new ActionRowBuilder().addComponents(select);
}

function buildRoleMenuComponents(guildId) {
  return getRoleMenuGroups(guildId)
    .slice(0, 5)
    .map((group) => buildRoleSelectRow(guildId, group));
}

function buildRoleMenuExtraComponents(guildId) {
  return getRoleMenuGroups(guildId)
    .slice(5)
    .map((group) => buildRoleSelectRow(guildId, group));
}

function buildRoleMenuPayload(guildId) {
  return {
    content: buildRoleMenuContent(),
    embeds: [],
    components: buildRoleMenuComponents(guildId),
    allowedMentions: { parse: [] },
  };
}

function buildRoleMenuExtraPayload(guildId) {
  const components = buildRoleMenuExtraComponents(guildId);
  return components.length > 0
    ? { content: '\u200b', components }
    : null;
}

function getGroupRoles(guildId, groupId) {
  return getMenuRoles(guildId).filter((role) => role.group === groupId).slice(0, 25);
}

async function handleRoleSelect(interaction) {
  const selectedRoleIds = interaction.values.filter((value) => !value.startsWith('empty:'));
  const botMember = interaction.guild.members.me;

  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await interaction.reply({ content: '❌ Botta Rolleri Yönet izni yok.', ephemeral: true });
    return;
  }

  let added = 0;
  let alreadyHad = 0;
  let skipped = 0;

  for (const roleId of selectedRoleIds) {
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || role.managed || !role.editable) {
      skipped += 1;
      continue;
    }

    try {
      if (interaction.member.roles.cache.has(role.id)) {
        alreadyHad += 1;
      } else {
        await interaction.member.roles.add(role.id);
        added += 1;
      }
    } catch (error) {
      skipped += 1;
      console.error('Rol verme hatası:', error.message);
    }
  }

  let content = '✅ ' + added + ' rol verildi.';
  if (alreadyHad) content += ' ' + alreadyHad + ' rol zaten sende.';
  if (skipped) content += '\n⚠️ ' + skipped + ' rol bot tarafından verilemiyor.';
  await interaction.reply({ content, ephemeral: true });
}

function buildRoomMenuComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('room-create')
        .setLabel('🎧 Ses Odası Aç')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

async function ensureRoomMenuInternal(guild) {
  if (!guild) {
    return;
  }

  const roomCategoryName = 'ÖZEL ODA LAR';
  let roomCategory = null;
  const savedRoomCategoryId = getCategoryId(guild.id, 'room');
  const savedRoomCategory = savedRoomCategoryId ? guild.channels.cache.get(savedRoomCategoryId) : null;

  if (savedRoomCategory?.type === ChannelType.GuildCategory) {
    roomCategory = savedRoomCategory;
  }

  if (!roomCategory) {
    roomCategory = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === roomCategoryName
    );
  }

  if (roomCategory) {
    saveCategoryId(guild.id, 'room', roomCategory.id);
  }

  const savedMainCategoryId = getMainCategoryId(guild.id);
  const mainCategory = savedMainCategoryId ? guild.channels.cache.get(savedMainCategoryId) : guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === 'LOGLAR'
  );
  const parentCategory = roomCategory || (mainCategory?.type === ChannelType.GuildCategory ? mainCategory : null);

  // Var olan oda-menusu nerede olursa olsun tekrar oluşturma; yoksa mevcut ana kategoriye koy.
  let roomChannel = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === 'oda-menusu'
  );

  if (!roomChannel) {
    const channelOptions = {
      name: 'oda-menusu',
      type: ChannelType.GuildText,
      reason: 'Özel oda oluşturma menüsü oluşturuluyor.',
    };
    if (parentCategory) {
      channelOptions.parent = parentCategory.id;
    }
    roomChannel = await guild.channels.create(channelOptions);
  }

  const messages = await roomChannel.messages.fetch({ limit: 50 }).catch(() => null);
  const existingMessage = messages?.find((message) => message.author.id === client.user.id && message.embeds[0]?.title === '🎧 Özel Oda Oluşturma');

  if (!existingMessage) {
    await roomChannel.send({ embeds: [buildRoomMenuEmbed()], components: buildRoomMenuComponents() });
  }
}

async function ensureRoomMenu(guild) {
  if (!guild) return;
  return runGuildTaskOnce(`room-menu:${guild.id}`, () => ensureRoomMenuInternal(guild));
}

async function ensureRoleMenuInternal(guild) {
  if (!guild) {
    return;
  }

  const roleMenuInfo = getRoleMenuMessage(guild.id);

  const isRoleMenuMessage = (message) =>
    message?.author?.id === client.user.id && (
      message.embeds?.some((embed) => embed.title === '👥 Rol Seçim Menüsü') ||
      message.content?.includes('Sunucuda etiket atıp rahatsızlık vermemek için')
    );

  const isRoleMenuContinuation = (message) =>
    message?.author?.id === client.user.id &&
    message.id !== roleMenuInfo?.messageId &&
    message.components?.some((row) => row.components?.some((component) =>
      component.customId?.startsWith('role-select:')
    ));

  const syncExtraMenu = async (roleChannel, messages) => {
    const extraPayload = buildRoleMenuExtraPayload(guild.id);
    const continuation = messages?.find(isRoleMenuContinuation);
    if (extraPayload) {
      if (continuation) {
        await continuation.edit(extraPayload);
      } else {
        await roleChannel.send(extraPayload);
      }
    }
  };

  const moveChannelOutOfCategory = async (channel) => {
    if (channel?.parentId) {
      await channel.setParent(null, { lockPermissions: false }).catch((error) => {
        console.error('Rol menüsü kanalı kategori dışına taşınamadı:', error.message);
      });
    }
  };

  try {
    // Sadece rol-menusu kanalı kullanılır; ROLLER kategorisi oluşturulmaz.
    await guild.channels.fetch().catch(() => null);
    let roleChannel = null;

    if (roleMenuInfo?.channelId) {
      const savedChannel = await guild.channels.fetch(roleMenuInfo.channelId).catch(() => null);
      if (savedChannel?.type === ChannelType.GuildText) {
        roleChannel = savedChannel;
        await moveChannelOutOfCategory(roleChannel);
        const message = await roleChannel.messages.fetch(roleMenuInfo.messageId).catch(() => null);
        if (message) {
          await message.edit(buildRoleMenuPayload(guild.id));
          const messages = await roleChannel.messages.fetch({ limit: 50 }).catch(() => null);
          await syncExtraMenu(roleChannel, messages);
          return;
        }
      }
    }

    if (!roleChannel) {
      roleChannel = guild.channels.cache.find((channel) =>
        channel.type === ChannelType.GuildText && channel.name === 'rol-menusu'
      );
    }

    if (!roleChannel) {
      roleChannel = await guild.channels.create({
        name: 'rol-menusu',
        type: ChannelType.GuildText,
        reason: 'Kategori olmadan rol seçim menüsü kanalı oluşturuluyor.',
      });
    } else {
      await moveChannelOutOfCategory(roleChannel);
    }

    const messages = await roleChannel.messages.fetch({ limit: 50 }).catch(() => null);
    const existingMenu = messages?.find(isRoleMenuMessage);
    if (existingMenu) {
      await existingMenu.edit(buildRoleMenuPayload(guild.id));
      saveRoleMenuMessage(guild.id, roleChannel.id, existingMenu.id);
      await syncExtraMenu(roleChannel, messages);
      return;
    }

    const newMessage = await roleChannel.send(buildRoleMenuPayload(guild.id));
    saveRoleMenuMessage(guild.id, roleChannel.id, newMessage.id);
    await syncExtraMenu(roleChannel, messages);
  } catch (error) {
    console.error('Rol menüsü oluşturma hatası:', error);
    throw error;
  }
}

async function ensureRoleMenu(guild) {
  if (!guild) return false;

  try {
    await runGuildTaskOnce(`role-menu:${guild.id}`, () => ensureRoleMenuInternal(guild));
    return true;
  } catch (error) {
    console.error(`[${guild.name}] Rol menüsü hazırlanamadı:`, error.message);
    return false;
  }
}

function getRoomOwnerMap() {
  if (!globalThis.roomOwnerMap) {
    globalThis.roomOwnerMap = new Map();
  }
  return globalThis.roomOwnerMap;
}

function getRoomControlChannel(guild, roomInfo) {
  if (!guild || !roomInfo) {
    return null;
  }

  const savedChannel = roomInfo.controlChannelId ? guild.channels.cache.get(roomInfo.controlChannelId) : null;
  if (savedChannel?.type === ChannelType.GuildText) {
    return savedChannel;
  }

  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && channel.topic === 'logbot-room:' + roomInfo.channelId
  ) || null;
}

function buildRoomManagementEmbed(roomInfo, voiceChannel) {
  return new EmbedBuilder()
    .setTitle('🎧 Oda Yönetimi')
    .setDescription('Bu özel ses odasına kimlerin girebileceğini aşağıdaki menülerden yönetebilirsin.')
    .setColor(Colors.Blurple)
    .addFields(
      { name: '📍 Ses Odası', value: String(voiceChannel), inline: true },
      { name: '👑 Oda Sahibi', value: '<@' + roomInfo.ownerId + '>', inline: true },
      { name: 'ℹ️ Bilgi', value: 'Bu menüyü yalnızca oda sahibi kullanabilir. Eklenen kişiler hem ses odasına hem de bu sohbet kanalına erişebilir.', inline: false }
    );
}

function buildRoomManagementComponents(voiceChannelId) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('room-members-add:' + voiceChannelId)
        .setPlaceholder('Odaya kişi ekle')
        .setMinValues(1)
        .setMaxValues(10)
    ),
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('room-members-remove:' + voiceChannelId)
        .setPlaceholder('Oda erişimini kaldır')
        .setMinValues(1)
        .setMaxValues(10)
    ),
  ];
}

async function ensureRoomManagementPanel(controlChannel, voiceChannel, roomInfo) {
  if (!controlChannel || controlChannel.type !== ChannelType.GuildText) {
    return;
  }

  const messages = await controlChannel.messages.fetch({ limit: 50 }).catch(() => null);
  const existingMessage = messages?.find((message) =>
    message.author.id === client.user.id && message.embeds[0]?.title === '🎧 Oda Yönetimi'
  );
  const payload = {
    embeds: [buildRoomManagementEmbed(roomInfo, voiceChannel)],
    components: buildRoomManagementComponents(voiceChannel.id),
  };

  if (existingMessage) {
    await existingMessage.edit(payload);
  } else {
    await controlChannel.send(payload);
  }
}

async function ensureRoomControlChannel(guild, roomInfo) {
  if (!guild || !roomInfo) {
    return null;
  }

  const voiceChannel = guild.channels.cache.get(roomInfo.channelId);
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    return null;
  }

  let controlChannel = getRoomControlChannel(guild, roomInfo);
  if (!controlChannel) {
    const controlOptions = {
      name: 'oda-sohbet-' + voiceChannel.id.slice(-8),
      type: ChannelType.GuildText,
      topic: 'logbot-room:' + voiceChannel.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: roomInfo.ownerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
      reason: 'Özel ses odası yönetim sohbeti oluşturuluyor.',
    };
    if (voiceChannel.parentId) {
      controlOptions.parent = voiceChannel.parentId;
    }
    controlChannel = await guild.channels.create(controlOptions);
  } else {
    await controlChannel.permissionOverwrites.edit(roomInfo.ownerId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }).catch(() => null);
  }

  roomInfo.controlChannelId = controlChannel.id;
  await ensureRoomManagementPanel(controlChannel, voiceChannel, roomInfo);
  return controlChannel;
}

async function updateRoomMemberAccess(roomInfo, userId, canAccess) {
  const guild = client.guilds.cache.get(roomInfo.guildId);
  const voiceChannel = guild?.channels.cache.get(roomInfo.channelId);
  if (!guild || !voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    return false;
  }

  const controlChannel = getRoomControlChannel(guild, roomInfo);
  if (canAccess) {
    await voiceChannel.permissionOverwrites.edit(userId, {
      Connect: true,
      ViewChannel: true,
    });
    if (controlChannel) {
      await controlChannel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    }
  } else {
    await voiceChannel.permissionOverwrites.edit(userId, {
      Connect: false,
      ViewChannel: false,
    }).catch(() => null);
    if (controlChannel) {
      await controlChannel.permissionOverwrites.edit(userId, {
        ViewChannel: false,
        SendMessages: false,
        ReadMessageHistory: false,
      }).catch(() => null);
    }
  }

  return true;
}

async function deletePrivateRoom(roomInfo, voiceChannel, reason) {
  const guild = client.guilds.cache.get(roomInfo.guildId);
  const controlChannel = getRoomControlChannel(guild, roomInfo);
  if (controlChannel) {
    await controlChannel.delete(reason).catch(() => null);
  }
  await voiceChannel.delete(reason);
  getRoomOwnerMap().delete(roomInfo.channelId);
}

function getPrivateRoomOwnerId(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice || !channel.guild) {
    return null;
  }

  const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
  if (!everyoneOverwrite?.deny.has(PermissionsBitField.Flags.Connect)) {
    return null;
  }

  const ownerOverwrite = channel.permissionOverwrites.cache.find((overwrite) =>
    overwrite.id !== channel.guild.roles.everyone.id &&
    channel.guild.members.cache.has(overwrite.id) &&
    overwrite.allow.has(PermissionsBitField.Flags.Connect) &&
    overwrite.allow.has(PermissionsBitField.Flags.ViewChannel)
  );
  return ownerOverwrite?.id || null;
}

function restorePrivateRoomOwners(guild) {
  const roomOwnerMap = getRoomOwnerMap();
  for (const channel of guild.channels.cache.values()) {
    const ownerId = getPrivateRoomOwnerId(channel);
    if (ownerId) {
      const controlChannel = getRoomControlChannel(guild, { channelId: channel.id });
      roomOwnerMap.set(channel.id, { ownerId, channelId: channel.id, guildId: guild.id, roomName: channel.name, controlChannelId: controlChannel?.id || null });
    }
  }
}

async function handleRoomCreateButton(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'Bu işlem bir sunucuda kullanılmalıdır.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('room-create-modal')
    .setTitle('🎧 Ses Odası Oluştur');

  const roomNameInput = new TextInputBuilder()
    .setCustomId('room-name')
    .setLabel('Oda adı')
    .setPlaceholder('Örnek: Takım Odası')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(50);

  const limitInput = new TextInputBuilder()
    .setCustomId('room-limit')
    .setLabel('Kişi limiti (opsiyonel)')
    .setPlaceholder('Örnek: 10')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2);

  modal.addComponents(
    new ActionRowBuilder().addComponents(roomNameInput),
    new ActionRowBuilder().addComponents(limitInput)
  );

  await interaction.showModal(modal);
}

async function handleRoomCreateModal(interaction) {
  const roomName = interaction.fields.getTextInputValue('room-name').trim();
  const rawLimit = interaction.fields.getTextInputValue('room-limit').trim();
  const userLimit = Number.parseInt(rawLimit, 10);

  const finalName = roomName || 'Özel Oda';
  const safeLimit = Number.isInteger(userLimit) && userLimit > 0 && userLimit <= 99 ? userLimit : 0;

  try {
    const roomOwnerMap = getRoomOwnerMap();
    const existingRoom = interaction.guild.channels.cache.find((channel) => getPrivateRoomOwnerId(channel) === interaction.user.id);
    if (existingRoom) {
      roomOwnerMap.set(existingRoom.id, { ownerId: interaction.user.id, channelId: existingRoom.id, guildId: interaction.guild.id, roomName: existingRoom.name });
      await interaction.reply({ content: `🎧 Zaten açık bir odan var: ${existingRoom}`, ephemeral: true });
      return;
    }

    const savedRoomCategoryId = getCategoryId(interaction.guild.id, 'room');
    const savedRoomCategory = savedRoomCategoryId ? interaction.guild.channels.cache.get(savedRoomCategoryId) : null;
    let roomCategory = savedRoomCategory?.type === ChannelType.GuildCategory ? savedRoomCategory : interaction.guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === 'ÖZEL ODA LAR'
    );

    if (!roomCategory) {
      const roomMenu = interaction.guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildText && channel.name === 'oda-menusu'
      );
      const menuParent = roomMenu?.parent;
      if (menuParent?.type === ChannelType.GuildCategory) {
        roomCategory = menuParent;
      }
    }

    if (roomCategory) {
      saveCategoryId(interaction.guild.id, 'room', roomCategory.id);
    }

    const roomOptions = {
      name: finalName,
      type: ChannelType.GuildVoice,
      userLimit: safeLimit,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.Connect],
        },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel],
        },
      ],
      reason: `${interaction.user.tag} özel ses odası oluşturdu.`,
    };

    if (roomCategory) {
      roomOptions.parent = roomCategory.id;
    }

    const room = await interaction.guild.channels.create(roomOptions);
    await room.setName(finalName + ' · ' + interaction.user.username);
    const roomInfo = { ownerId: interaction.user.id, channelId: room.id, guildId: interaction.guild.id, roomName: finalName, controlChannelId: null };
    roomOwnerMap.set(room.id, roomInfo);
    const controlChannel = await ensureRoomControlChannel(interaction.guild, roomInfo);

    await interaction.reply({ content: '🎧 Oda hazır: ' + room + (controlChannel ? '\n🛠️ Yönetim sohbeti: ' + controlChannel : ''), ephemeral: true });
  } catch (error) {
    console.error('Oda oluşturma hatası:', error);
    await interaction.reply({ content: '⚠️ Oda oluşturulurken bir hata oluştu.', ephemeral: true });
  }
}

async function checkPrivateRoomAutoClose(oldState, newState) {
  if (!oldState.channelId && !newState.channelId) {
    return;
  }

  const guild = newState.guild || oldState.guild;
  if (!guild) {
    return;
  }

  if (!globalThis.roomOwnerMap) {
    globalThis.roomOwnerMap = new Map();
  }

  const roomInfo = getRoomOwnerMap().get(oldState.channelId || newState.channelId);
  if (!roomInfo) {
    return;
  }

  const channel = guild.channels.cache.get(roomInfo.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return;
  }

  const members = channel.members;
  if (members.size === 0) {
    try {
      await deletePrivateRoom(roomInfo, channel, 'Özel oda boş olduğu için kapatıldı: ' + roomInfo.ownerId);
    } catch (error) {
      console.error('Özel oda kapatma hatası:', error);
    }
    return;
  }

  const ownerStillInRoom = members.has(roomInfo.ownerId);
  if (!ownerStillInRoom) {
    try {
      await deletePrivateRoom(roomInfo, channel, 'Özel oda sahibinin odadan ayrılması nedeniyle kapatıldı.');
    } catch (error) {
      console.error('Özel oda kapatma hatası:', error);
    }
  }
}

async function handleRoomCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  await ensureRoomMenu(message.guild);
  await message.reply({ content: '🎧 Oda menüsü `oda-menusu` kanalında hazır!' });
}

async function handleRoleAddCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!message.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    await message.reply('❌ Bu komut için Rolleri Yönet izni gerekir.');
    return;
  }

  const roleMatch = message.mentions.roles.first();
  if (!roleMatch) {
    await message.reply('Kullanım: .roller-ekle @rol kategori\nÖrnek: .roller-ekle @Oyuncu oyun');
    return;
  }

  if (!roleMatch.editable) {
    await message.reply('❌ Bu rol botun en yüksek rolünün altında değil.');
    return;
  }

  const values = args.slice(1);
  const categoryToken = values.find((value) =>
    Object.prototype.hasOwnProperty.call(ROLE_GROUP_ALIASES, String(value).trim().toLocaleLowerCase('tr-TR'))
  );
  const emojiToken = values.find((value) => Object.values(ROLE_GROUP_EMOJIS).includes(value));
  const group = categoryToken ? normalizeRoleGroup(categoryToken) : (emojiToken
    ? Object.entries(ROLE_GROUP_EMOJIS).find(([, emoji]) => emoji === emojiToken)?.[0] || 'general'
    : 'general');
  const emoji = ROLE_GROUP_EMOJIS[group] || '🎭';

  try {
    addRoleToMenu(message.guild.id, roleMatch.id, emoji, group);
    const menuReady = await ensureRoleMenu(message.guild);
    const embed = new EmbedBuilder()
      .setTitle('✅ Rol Eklendi')
      .setDescription(emoji + ' ' + roleMatch.name + ' rol menüsünde **' + group + '** kategorisine eklendi.' + (menuReady ? '' : '\n\n⚠️ Menü mesajı yenilenemedi; konsol logunu kontrol et.'))
      .setColor(Colors.Green);
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Rol ekleme hatası:', error);
    await message.reply('❌ Rol eklenirken hata oluştu.');
  }
}
async function handleRoleRemoveCommand(message, args) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  if (!message.member?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
    await message.reply('❌ Bu komut için Rolleri Yönet izni gerekir.');
    return;
  }

  const roleMatch = message.mentions.roles.first();
  if (!roleMatch) {
    await message.reply('Geçerli bir rol etiketle.');
    return;
  }

  try {
    removeRoleFromMenu(message.guild.id, roleMatch.id);
    await ensureRoleMenu(message.guild);
    const embed = new EmbedBuilder()
      .setTitle('✅ Rol Silindi')
      .setDescription(roleMatch.name + ' rol menüsünden silindi.')
      .setColor(Colors.Green);
    await message.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Rol silme hatası:', error);
    await message.reply('❌ Rol silinirken hata oluştu.');
  }
}
async function handleRoleMenuCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  const menuReady = await ensureRoleMenu(message.guild);
  if (!menuReady) {
    await message.reply('❌ Rol menüsü oluşturulamadı. Botta Kanal Yönet ve Mesaj Gönder izinlerini kontrol et.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Rol Menüsü Hazırlandı')
    .setDescription('Rol seçim menüsü `rol-menusu` kanalında oluşturuldu.')
    .setColor(Colors.Green);
  
  await message.reply({ embeds: [embed] });
}

async function handleRoleCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  const menuReady = await ensureRoleMenu(message.guild);
  if (!menuReady) {
    await message.reply('❌ Rol menüsü oluşturulamadı. Botta Kanal Yönet ve Mesaj Gönder izinlerini kontrol et.');
    return;
  }

  await message.reply(buildRoleMenuPayload(message.guild.id));
  const extraPayload = buildRoleMenuExtraPayload(message.guild.id);
  if (extraPayload) {
    await message.channel.send(extraPayload);
  }
}

async function handleHelpCommand(message) {
  await message.reply({ embeds: [buildHelpEmbed()] });
}

client.on(Events.ClientReady, async () => {
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'Darth.vfx', type: 3 }],
  });
  console.log(`Bot aktif: ${client.user.tag} | Sunucu sayısı: ${client.guilds.cache.size}`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await updateGuildInviteSnapshot(guild);
      restorePrivateRoomOwners(guild);
      for (const roomInfo of getRoomOwnerMap().values()) {
        if (roomInfo.guildId !== guild.id) continue;
        try {
          await ensureRoomControlChannel(guild, roomInfo);
        } catch (error) {
          console.error('Oda yönetim sohbeti hazırlanamadı:', error.message);
        }
      }
      await ensureRoomMenu(guild);
      await ensureRoleMenu(guild);
    } catch (error) {
      console.error(`[${guild.name}] başlangıç ayarı tamamlanamadı:`, error.message);
    }
  }

  console.log('Discord bağlantısı hazır. Prefix komutları kullanılabilir.');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) {
    return;
  }

  const content = message.content.slice(PREFIX.length).trim();
  const [command, ...args] = content.split(/\s+/);

  if (command === 'setup') {
    await handleSetupCommand(message);
    return;
  }

  if (command === 'log') {
    await handleLogCommand(message);
    return;
  }

  if (command === 'oda') {
    await handleRoomCommand(message);
    return;
  }

  if (command === 'boost-kanal') {
    await handleBoostChannelCommand(message);
    return;
  }

  if (command === 'boost-gif') {
    await handleBoostGifCommand(message, args);
    return;
  }

  if (command === 'boost-test') {
    await handleBoostTestCommand(message);
    return;
  }

  if (command === 'boost-baslik') {
    await handleBoostTitleCommand(message, args);
    return;
  }

  if (command === 'boost-mesaj') {
    await handleBoostMessageCommand(message, args);
    return;
  }

  if (command === 'roller-ekle' || command === 'rol-ekle') {
    await handleRoleAddCommand(message, args);
    return;
  }

  if (command === 'roller-sil') {
    await handleRoleRemoveCommand(message, args);
    return;
  }

  if (command === 'roller-menu') {
    await handleRoleMenuCommand(message);
    return;
  }

  if (command === 'roller') {
    await handleRoleCommand(message);
    return;
  }

  if (command === 'help' || command === 'yardım' || command === 'yardim') {
    await handleHelpCommand(message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'room-create') {
      await handleRoomCreateButton(interaction);
      return;
    }


    // Eski menü mesajlarıyla uyumluluk için admin butonları
    if (interaction.customId === 'role-menu-add') {
      // Rol ekle butonu - admin modal aç
      if (!interaction.member.permissions.has('ManageRoles')) {
        await interaction.reply({ content: '❌ Rol yönetme iznine sahip değilsin.', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('role-add-modal')
        .setTitle('Rol Ekle');

      const roleInput = new TextInputBuilder()
        .setCustomId('role-id-input')
        .setLabel('Rol ID veya @rol')
        .setPlaceholder('Örnek: @Moderator')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const emojiInput = new TextInputBuilder()
        .setCustomId('emoji-input')
        .setLabel('Emoji')
        .setPlaceholder('Örnek: 🛡️')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(roleInput),
        new ActionRowBuilder().addComponents(emojiInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'role-menu-remove') {
      // Rol sil butonu - admin modal aç
      if (!interaction.member.permissions.has('ManageRoles')) {
        await interaction.reply({ content: '❌ Rol yönetme iznine sahip değilsin.', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('role-remove-modal')
        .setTitle('Rol Sil');

      const roleInput = new TextInputBuilder()
        .setCustomId('role-id-input')
        .setLabel('Rol ID veya @rol')
        .setPlaceholder('Örnek: @Moderator')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(roleInput));

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'role-menu-refresh') {
      // Menüyü güncelle
      if (!interaction.member.permissions.has('ManageRoles')) {
        await interaction.reply({ content: '❌ Rol yönetme iznine sahip değilsin.', ephemeral: true });
        return;
      }

      await ensureRoleMenu(interaction.guild);
      await interaction.reply({ content: '✅ Rol menüsü güncellendi!', ephemeral: true });
      return;
    }

    // Kullanıcı rol seçme butonları
    if (interaction.customId.startsWith('role-toggle:')) {
      const roleId = interaction.customId.replace('role-toggle:', '');
      const member = interaction.member;
      const role = interaction.guild.roles.cache.get(roleId);

      if (!role) {
        await interaction.reply({ content: '❌ Rol bulunamadı.', ephemeral: true });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await interaction.reply({ content: '❌ Botta Rolleri Yönet izni yok.', ephemeral: true });
        return;
      }

      if (!role.editable) {
        await interaction.reply({ content: '❌ Bu rol botun en yüksek rolünün altında değil; rol hiyerarşisini kontrol et.', ephemeral: true });
        return;
      }

      try {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          await interaction.reply({ content: `✅ **${role.name}** rolü kaldırıldı.`, ephemeral: true });
        } else {
          await member.roles.add(roleId);
          await interaction.reply({ content: `✅ **${role.name}** rolü eklendi.`, ephemeral: true });
        }
      } catch (error) {
        console.error('Rol toggle hatası:', error);
        const content = error?.code === 50013
          ? '❌ Botun bu rolü yönetme yetkisi yok. Bot rolünü hedef rolün üstüne taşı.'
          : '❌ Rol değiştirilirken hata oluştu.';
        await interaction.reply({ content, ephemeral: true });
      }
      return;
    }

    if (!interaction.customId.startsWith('toggle:')) {
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      return;
    }

    const logKey = interaction.customId.replace('toggle:', '');
    if (!LOG_DEFINITIONS[logKey]) {
      return;
    }

    try {
      const nextState = !isLogEnabled(guild.id, logKey);
      setLogEnabled(guild.id, logKey, nextState);

      const updatedEmbed = buildLogPanel(guild.id);
      const updatedButtons = [
        ...createToggleButtons(guild.id),
        ...createChannelSelectionMenus(),
      ];

      await interaction.update({ embeds: [updatedEmbed], components: updatedButtons });
    } catch (error) {
      if (error?.code === 10062 || error?.status === 404) {
        console.log('Eski/eksik interaction yok sayıldı.');
        return;
      }

      console.error('Interaction işlenirken hata oluştu:', error);
    }

    return;
  }

  if (interaction.isUserSelectMenu() && interaction.customId.startsWith('room-members-')) {
    const parts = interaction.customId.split(':');
    const action = parts[0];
    const roomChannelId = parts[1];
    const roomInfo = getRoomOwnerMap().get(roomChannelId);

    if (!interaction.guild || !roomInfo || roomInfo.ownerId !== interaction.user.id) {
      await interaction.reply({ content: '❌ Bu menüyü yalnızca oda sahibi kullanabilir.', ephemeral: true });
      return;
    }

    const voiceChannel = interaction.guild.channels.cache.get(roomChannelId);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.reply({ content: '❌ Ses odası artık bulunamıyor.', ephemeral: true });
      return;
    }

    const canAccess = action === 'room-members-add';
    let changedCount = 0;
    for (const userId of interaction.values) {
      if (userId === roomInfo.ownerId) {
        continue;
      }

      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member || member.user.bot) {
        continue;
      }

      try {
        if (await updateRoomMemberAccess(roomInfo, userId, canAccess)) {
          changedCount += 1;
        }
      } catch (error) {
        console.error('Oda üyesi erişim güncelleme hatası:', error.message);
      }
    }

    await interaction.reply({
      content: canAccess
        ? '✅ ' + changedCount + ' kişi odaya eklendi.'
        : '✅ ' + changedCount + ' kişinin oda erişimi kaldırıldı.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('role-select:')) {
      await handleRoleSelect(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'room-create-modal') {
      await handleRoomCreateModal(interaction);
      return;
    }

    if (interaction.customId === 'role-add-modal') {
      const roleInput = interaction.fields.getTextInputValue('role-id-input').trim();
      const emoji = interaction.fields.getTextInputValue('emoji-input').trim();

      const roleId = roleInput.match(/^<@&(\d+)>$/)?.[1] || roleInput;

      const roleMatch = interaction.guild.roles.cache.get(roleId) ||
                        interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleInput.toLowerCase()) ||
                        interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes(roleInput.toLowerCase()));

      if (!roleMatch) {
        await interaction.reply({ content: `❌ Rol bulunamadı: ${roleInput}`, ephemeral: true });
        return;
      }

      try {
        addRoleToMenu(interaction.guild.id, roleMatch.id, emoji);
        await ensureRoleMenu(interaction.guild);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Rol Eklendi')
          .setDescription(`${emoji} **${roleMatch.name}** rol menüsüne eklendi.`)
          .setColor(Colors.Green);
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (error) {
        console.error('Rol ekleme hatası:', error);
        await interaction.reply({ content: '❌ Rol eklenirken hata oluştu.', ephemeral: true });
      }
      return;
    }

    if (interaction.customId === 'role-remove-modal') {
      const roleInput = interaction.fields.getTextInputValue('role-id-input').trim();

      const roleId = roleInput.match(/^<@&(\d+)>$/)?.[1] || roleInput;

      const roleMatch = interaction.guild.roles.cache.get(roleId) ||
                        interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleInput.toLowerCase()) ||
                        interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes(roleInput.toLowerCase()));

      if (!roleMatch) {
        await interaction.reply({ content: `❌ Rol bulunamadı: ${roleInput}`, ephemeral: true });
        return;
      }

      try {
        removeRoleFromMenu(interaction.guild.id, roleMatch.id);
        await ensureRoleMenu(interaction.guild);

        const embed = new EmbedBuilder()
          .setTitle('✅ Rol Silindi')
          .setDescription(`**${roleMatch.name}** rol menüsünden silindi.`)
          .setColor(Colors.Green);
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (error) {
        console.error('Rol silme hatası:', error);
        await interaction.reply({ content: '❌ Rol silinirken hata oluştu.', ephemeral: true });
      }
      return;
    }
  }

  if (interaction.isChannelSelectMenu()) {
    if (!interaction.customId.startsWith('channel-select:')) {
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      return;
    }

    const logKey = interaction.customId.replace('channel-select:', '');
    if (!LOG_DEFINITIONS[logKey]) {
      return;
    }

    const selectedChannelId = interaction.channels.first()?.id ?? null;
    saveLogChannel(guild.id, logKey, selectedChannelId);

    const updatedEmbed = buildLogPanel(guild.id);
    const updatedButtons = [
      ...createToggleButtons(guild.id),
      ...createChannelSelectionMenus(),
    ];

    try {
      await interaction.update({ embeds: [updatedEmbed], components: updatedButtons });
    } catch (error) {
      if (error?.code === 10062 || error?.status === 404) {
        console.log('Eski/eksik channel select interaction yok sayıldı.');
      }
    }
  }

});

client.on(Events.GuildMemberAdd, async (member) => {
  const inviteInfo = await getInviteJoinInfo(member);

  const embed = new EmbedBuilder()
    .setTitle('🟢 Üye Sunucuya Katıldı')
    .setColor(Colors.Green)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${member.user.id}>`, inline: true },
      { name: '🆔 Kullanıcı ID', value: `\`${member.user.id}\``, inline: true },
      { name: '📨 Davet Eden', value: inviteInfo.inviter, inline: true },
      { name: '📊 Toplam Davet', value: `${inviteInfo.totalInvites}`, inline: true },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(member.guild.id, 'member', embed);
});

client.on(Events.GuildMemberRemove, async (member) => {
  const embed = new EmbedBuilder()
    .setTitle('🔴 Üye Sunucudan Ayrıldı')
    .setColor(Colors.Red)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${member.user.id}>`, inline: true },
      { name: '🆔 Kullanıcı ID', value: `\`${member.user.id}\``, inline: true },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(member.guild.id, 'member', embed);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const oldDisplay = oldMember.displayName;
  const newDisplay = newMember.displayName;

  if (oldDisplay !== newDisplay) {
    const embed = new EmbedBuilder()
      .setTitle('✏️ Üye Bilgisi Değişti')
      .setColor(Colors.Orange)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newMember.user.id}>`, inline: true },
        { name: '🆔 Kullanıcı ID', value: `\`${newMember.user.id}\``, inline: true },
        { name: '📜 Eski Ad', value: oldDisplay || 'Belirtilmedi', inline: true },
        { name: '📜 Yeni Ad', value: newDisplay || 'Belirtilmedi', inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newMember.guild.id, 'member', embed);
  }

  const timeoutChanged = oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp;
  if (timeoutChanged && newMember.communicationDisabledUntilTimestamp) {
    const { executor, reason } = await getAuditLogInfo(newMember.guild, newMember.user.id, AuditLogEvent.MemberUpdate);
    const embed = new EmbedBuilder()
      .setTitle('⏱️ Kullanıcı Timeout Alındı')
      .setColor(Colors.Yellow)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newMember.user.id}>`, inline: true },
        { name: '🆔 Kullanıcı ID', value: `\`${newMember.user.id}\``, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newMember.guild.id, 'moderation', embed);
  }

  const startedBoosting = !oldMember.premiumSinceTimestamp && Boolean(newMember.premiumSinceTimestamp);
  if (startedBoosting) {
    await sendLog(newMember.guild.id, 'boost', buildBoostNotificationEmbed(newMember));
  }


  if (!oldMember.roles.cache.equals(newMember.roles.cache)) {
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id)).map((role) => role.name);
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id)).map((role) => role.name);

    const embed = new EmbedBuilder()
      .setTitle('🎭 Rol Verme/Alma')
      .setColor(Colors.Blurple)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newMember.user.id}>`, inline: true },
        { name: '🆔 Kullanıcı ID', value: `\`${newMember.user.id}\``, inline: true },
        { name: '➕ Eklenen Roller', value: added.length ? added.join(', ') : 'Yok', inline: false },
        { name: '➖ Alınan Roller', value: removed.length ? removed.join(', ') : 'Yok', inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newMember.guild.id, 'role', embed);
  }
});

client.on(Events.MessageDelete, async (message) => {
  if (message.author?.bot) {
    return;
  }

  const attachment = message.attachments.first();
  const directMediaUrl = typeof message.content === 'string'
    ? message.content.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|avif|mp4|mov|mp3|wav|ogg)(?:\?[^\s]*)?/i)?.[0]
    : null;
  const embedPreviewUrl = attachment?.url || directMediaUrl || message.embeds?.[0]?.image?.url || message.embeds?.[0]?.thumbnail?.url;
  const shouldHideContent = Boolean(attachment || embedPreviewUrl || directMediaUrl || message.embeds?.length);
  const visibleMessage = shouldHideContent ? 'Medya dosyası silindi' : `\`${truncateText(message.content)}\``;

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Mesaj Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '👤 Kullanıcı', value: message.author ? `<@${message.author.id}>` : 'Bilinmeyen', inline: true },
      { name: '📍 Kanal', value: message.channel ? `<#${message.channel.id}>` : 'Bilinmeyen', inline: true },
      { name: '💬 Mesaj', value: visibleMessage, inline: false },
      { name: '🆔 Mesaj ID', value: `\`${message.id}\``, inline: true },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: true }
    );

  if (embedPreviewUrl) {
    embed.setImage(embedPreviewUrl);
  }

  await sendLog(message.guild.id, 'message', embed);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot || newMessage.author?.bot) {
    return;
  }

  if (oldMessage.content === newMessage.content) {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('✏️ Mesaj Düzenlendi')
    .setColor(Colors.Orange)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${newMessage.author.id}>`, inline: true },
      { name: '📍 Kanal', value: `<#${newMessage.channel.id}>`, inline: true },
      { name: '📝 Eski Mesaj', value: `\`${truncateText(oldMessage.content)}\``, inline: false },
      { name: '📝 Yeni Mesaj', value: `\`${truncateText(newMessage.content)}\``, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newMessage.guild.id, 'message', embed);
});

client.on(Events.MessageBulkDelete, async (messages) => {
  const collection = messages.filter((message) => !message.author?.bot);
  const count = collection.size;
  if (count === 0) {
    return;
  }

  const firstMessage = collection.first();
  const embed = new EmbedBuilder()
    .setTitle('🧹 Toplu Mesaj Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '📍 Kanal', value: firstMessage ? `<#${firstMessage.channel.id}>` : 'Bilinmeyen', inline: true },
      { name: '🧮 Toplam', value: `${count}`, inline: true },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(firstMessage.guild.id, 'message', embed);
});

client.on(Events.GuildBanAdd, async (ban) => {
  const { executor, reason } = await getAuditLogInfo(ban.guild, ban.user.id, AuditLogEvent.MemberBanAdd);

  const embed = new EmbedBuilder()
    .setTitle('🔨 Kullanıcı Yasaklandı')
    .setColor(Colors.Red)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${ban.user.id}>`, inline: true },
      { name: '🆔 Kullanıcı ID', value: `\`${ban.user.id}\``, inline: true },
      { name: '🛡️ Yasaklayan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason || (ban.reason ? `${ban.reason}` : 'Sebep belirtilmedi'), inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(ban.guild.id, 'moderation', embed);
});

client.on(Events.GuildBanRemove, async (ban) => {
  const { executor, reason } = await getAuditLogInfo(ban.guild, ban.user.id, AuditLogEvent.MemberBanRemove);

  const embed = new EmbedBuilder()
    .setTitle('🔓 Kullanıcının Yasağı Kaldırıldı')
    .setColor(Colors.Green)
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${ban.user.id}>`, inline: true },
      { name: '🆔 Kullanıcı ID', value: `\`${ban.user.id}\``, inline: true },
      { name: '🛡️ Kaldıran', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(ban.guild.id, 'moderation', embed);
});

client.on(Events.GuildAuditLogEntryCreate, async (auditLogEntry) => {
  if (!auditLogEntry.guild || !auditLogEntry.target) {
    return;
  }

  const targetUser = auditLogEntry.target;
  const executor = auditLogEntry.executor ? `<@${auditLogEntry.executor.id}>` : 'Bilinmeyen';
  const reason = auditLogEntry.reason || 'Sebep belirtilmedi';

  if (auditLogEntry.action === AuditLogEvent.MemberKick) {
    const embed = new EmbedBuilder()
      .setTitle('👢 Kullanıcı Atıldı')
      .setColor(Colors.Orange)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
    return;
  }

  if (auditLogEntry.action === AuditLogEvent.MemberBanAdd) {
    const embed = new EmbedBuilder()
      .setTitle('🔨 Kullanıcı Yasaklandı')
      .setColor(Colors.Red)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
    return;
  }

  if (auditLogEntry.action === AuditLogEvent.MemberBanRemove) {
    const embed = new EmbedBuilder()
      .setTitle('🔓 Kullanıcının Yasağı Kaldırıldı')
      .setColor(Colors.Green)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
    return;
  }

  if (auditLogEntry.action === AuditLogEvent.MemberUpdate) {
    const hasTimeoutChange = auditLogEntry.changes?.some((change) => change.key === 'communication_disabled_until');

    if (!hasTimeoutChange) {
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('⏱️ Kullanıcı Timeout Alındı')
      .setColor(Colors.Yellow)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${targetUser.id}>`, inline: true },
        { name: '🛡️ Yetkili', value: executor, inline: true },
        { name: '📝 Sebep', value: reason, inline: false },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(auditLogEntry.guild.id, 'moderation', embed);
  }
});

client.on(Events.RoleCreate, async (role) => {
  const { executor, reason } = await getAuditLogInfo(role.guild, role.id, AuditLogEvent.RoleCreate);

  const embed = new EmbedBuilder()
    .setTitle('🟢 Rol Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '🎭 Rol', value: `${role}`, inline: true },
      { name: '🆔 Rol ID', value: `\`${role.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(role.guild.id, 'role', embed);
});

client.on(Events.RoleDelete, async (role) => {
  const { executor, reason } = await getAuditLogInfo(role.guild, role.id, AuditLogEvent.RoleDelete);

  const embed = new EmbedBuilder()
    .setTitle('🔴 Rol Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '🎭 Rol', value: role.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Rol ID', value: `\`${role.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(role.guild.id, 'role', embed);
});

client.on(Events.RoleUpdate, async (oldRole, newRole) => {
  const { executor, reason } = await getAuditLogInfo(newRole.guild, newRole.id, AuditLogEvent.RoleUpdate);

  const embed = new EmbedBuilder()
    .setTitle('✏️ Rol Değiştirildi')
    .setColor(Colors.Orange)
    .addFields(
      { name: '🎭 Rol', value: `${newRole}`, inline: true },
      { name: '🆔 Rol ID', value: `\`${newRole.id}\``, inline: true },
      { name: '🛡️ Değiştiren', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newRole.guild.id, 'role', embed);
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(channel.guild, channel.id, AuditLogEvent.ChannelCreate);

  const embed = new EmbedBuilder()
    .setTitle('🟢 Kanal Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '📍 Kanal', value: `<#${channel.id}>`, inline: true },
      { name: '🆔 Kanal ID', value: `\`${channel.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(channel.guild.id, 'channel', embed);
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(channel.guild, channel.id, AuditLogEvent.ChannelDelete);

  const embed = new EmbedBuilder()
    .setTitle('🔴 Kanal Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '📍 Kanal', value: channel.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Kanal ID', value: `\`${channel.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(channel.guild.id, 'channel', embed);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (oldChannel.name === newChannel.name && oldChannel.type === newChannel.type) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(newChannel.guild, newChannel.id, AuditLogEvent.ChannelUpdate);

  const embed = new EmbedBuilder()
    .setTitle('✏️ Kanal Değiştirildi')
    .setColor(Colors.Orange)
    .addFields(
      { name: '📍 Kanal', value: `<#${newChannel.id}>`, inline: true },
      { name: '🆔 Kanal ID', value: `\`${newChannel.id}\``, inline: true },
      { name: '🛡️ Değiştiren', value: executor, inline: true },
      { name: '📜 Eski Ad', value: oldChannel.name || 'Bilinmeyen', inline: true },
      { name: '📜 Yeni Ad', value: newChannel.name || 'Bilinmeyen', inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newChannel.guild.id, 'channel', embed);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.guild) {
    return;
  }

  await checkPrivateRoomAutoClose(oldState, newState);

  if (!oldState.channelId && newState.channelId) {
    const embed = new EmbedBuilder()
      .setTitle('🔊 Ses Kanalına Girdi')
      .setColor(Colors.Green)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newState.member?.user?.id ?? '0'}>`, inline: true },
        { name: '📍 Kanal', value: `<#${newState.channelId}>`, inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newState.guild.id, 'voice', embed);
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    const embed = new EmbedBuilder()
      .setTitle('🔇 Ses Kanalından Ayrıldı')
      .setColor(Colors.Red)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${oldState.member?.user?.id ?? '0'}>`, inline: true },
        { name: '📍 Kanal', value: `<#${oldState.channelId}>`, inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(oldState.guild.id, 'voice', embed);
    return;
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const embed = new EmbedBuilder()
      .setTitle('🔄 Ses Kanalı Değişti')
      .setColor(Colors.Orange)
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${newState.member?.user?.id ?? '0'}>`, inline: true },
        { name: '🕘 Eski Kanal', value: `<#${oldState.channelId}>`, inline: true },
        { name: '🕘 Yeni Kanal', value: `<#${newState.channelId}>`, inline: true },
        { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
      );

    await sendLog(newState.guild.id, 'voice', embed);
  }
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (oldGuild.name === newGuild.name) {
    return;
  }

  const { executor, reason } = await getAuditLogInfo(newGuild, newGuild.id, AuditLogEvent.GuildUpdate);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Sunucu Değiştirildi')
    .setColor(Colors.Blurple)
    .addFields(
      { name: '🧾 Eski İsim', value: oldGuild.name || 'Bilinmeyen', inline: true },
      { name: '🧾 Yeni İsim', value: newGuild.name || 'Bilinmeyen', inline: true },
      { name: '🛡️ Değiştiren', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(newGuild.id, 'guild', embed);
});

client.on(Events.GuildEmojiCreate, async (emoji) => {
  const { executor, reason } = await getAuditLogInfo(emoji.guild, emoji.id, AuditLogEvent.EmojiCreate);

  const embed = new EmbedBuilder()
    .setTitle('😀 Emoji Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '🧩 Emoji', value: `${emoji}`, inline: true },
      { name: '🆔 Emoji ID', value: `\`${emoji.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(emoji.guild.id, 'guild', embed);
});

client.on(Events.GuildEmojiDelete, async (emoji) => {
  const { executor, reason } = await getAuditLogInfo(emoji.guild, emoji.id, AuditLogEvent.EmojiDelete);

  const embed = new EmbedBuilder()
    .setTitle('😀 Emoji Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '🧩 Emoji', value: `${emoji.name || 'Bilinmeyen'}`, inline: true },
      { name: '🆔 Emoji ID', value: `\`${emoji.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(emoji.guild.id, 'guild', embed);
});

client.on(Events.GuildStickerCreate, async (sticker) => {
  const { executor, reason } = await getAuditLogInfo(sticker.guild, sticker.id, AuditLogEvent.StickerCreate);

  const embed = new EmbedBuilder()
    .setTitle('🖼️ Sticker Oluşturuldu')
    .setColor(Colors.Green)
    .addFields(
      { name: '🧩 Sticker', value: sticker.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Sticker ID', value: `\`${sticker.id}\``, inline: true },
      { name: '🛡️ Oluşturan', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(sticker.guild.id, 'guild', embed);
});

client.on(Events.GuildStickerDelete, async (sticker) => {
  const { executor, reason } = await getAuditLogInfo(sticker.guild, sticker.id, AuditLogEvent.StickerDelete);

  const embed = new EmbedBuilder()
    .setTitle('🖼️ Sticker Silindi')
    .setColor(Colors.Red)
    .addFields(
      { name: '🧩 Sticker', value: sticker.name || 'Bilinmeyen', inline: true },
      { name: '🆔 Sticker ID', value: `\`${sticker.id}\``, inline: true },
      { name: '🛡️ Silen', value: executor, inline: true },
      { name: '📝 Sebep', value: reason, inline: false },
      { name: '📅 Tarih', value: new Date().toLocaleString('tr-TR'), inline: false }
    );

  await sendLog(sticker.guild.id, 'guild', embed);
});

client.on('error', (error) => {
  console.error('Discord istemci hatası:', error.message);
});

client.on('warn', (message) => {
  console.warn('Discord uyarısı:', message);
});

client.on('shardDisconnect', (closeEvent, shardId) => {
  console.error(`Discord bağlantısı koptu (shard ${shardId}). Kod: ${closeEvent?.code ?? 'bilinmiyor'}`);
});

client.on('shardReconnecting', (shardId) => {
  console.warn(`Discord bağlantısı yeniden kuruluyor (shard ${shardId})...`);
});

client.on('invalidated', () => {
  console.error('Discord oturumu geçersiz hale geldi. Botu yeniden başlatın.');
});

require('./v2').initializeV2({
  client,
  rest,
  sendLog,
  commandHandlers: {
    setup: handleSetupCommand,
    log: handleLogCommand,
    oda: handleRoomCommand,
    roller: handleRoleCommand,
    help: handleHelpCommand,
  },
});

client.login(discordToken).catch((error) => {
  console.error('Bot giriş başarısız:', error.message);
  process.exit(1);
});
