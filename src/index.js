const { Client, GatewayIntentBits, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, REST, Routes, ChannelSelectMenuBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, AuditLogEvent, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const { config } = require('dotenv');
config();
const { printBanner, printSuccess, printError } = require('./console-ui');

const discordToken = process.env.DISCORD_TOKEN?.trim();
if (!discordToken || discordToken === 'your_discord_bot_token_here') {
  console.error('DISCORD_TOKEN bulunamadı. Proje klasöründeki .env dosyasını doldurun.');
  process.exit(1);
}

const {
  ensureGuildDefaults,
  saveMainCategoryId,
  saveCategoryId,
  getMainCategoryId,
  getCategoryId,
  addRoleToMenu,
  removeRoleFromMenu,
  getMenuRoles,
  getRoleEmoji,
  saveRoleMenuMessage,
  getRoleMenuMessage,
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
const BOT_VOICE_CHANNEL_NAME = '</>';

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
const rest = new REST({ version: '10' }).setToken(discordToken);
const inviteSnapshots = new Map();
const inviteTotals = new Map();
const inFlightGuildTasks = new Map();
const voiceReconnectTimers = new Map();

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

function getConfiguredBotVoiceChannel(guild) {
  return guild?.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildVoice && channel.name === BOT_VOICE_CHANNEL_NAME
  ) || null;
}

function scheduleBotVoiceReconnect(guild) {
  if (!guild || voiceReconnectTimers.has(guild.id)) return;
  const timer = setTimeout(() => {
    voiceReconnectTimers.delete(guild.id);
    keepBotInConfiguredVoiceChannel(guild).catch((error) => console.error('Bot ses yeniden bağlanma hatası:', error.message));
  }, 5000);
  timer.unref?.();
  voiceReconnectTimers.set(guild.id, timer);
}

async function keepBotInConfiguredVoiceChannel(guild) {
  const target = getConfiguredBotVoiceChannel(guild);
  if (!target || !guild.voiceAdapterCreator) return null;
  const existing = getVoiceConnection(guild.id);
  if (existing?.joinConfig?.channelId === target.id) return existing;
  existing?.destroy();

  const connection = joinVoiceChannel({
    channelId: target.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await entersState(connection, VoiceConnectionStatus.Signalling, 5000);
    } catch {
      connection.destroy();
      scheduleBotVoiceReconnect(guild);
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => scheduleBotVoiceReconnect(guild));
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  } catch (error) {
    connection.destroy();
    scheduleBotVoiceReconnect(guild);
    console.error('Bot ses kanalına bağlanamadı:', error.message);
  }
  return connection;
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

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('🆘 Detaylı Yardım')
    .setDescription('Bu bot; register, moderasyon, seviye/XP, leaderboard, rol seçimleri ve özel ses odalarını yönetir. Ana komutlar slash (/) olarak kullanılabilir; eski nokta (.) prefixleri geriye dönük uyumluluk için açıktır.')
    .setColor(Colors.Blurple)
    .addFields(
      { name: '🚀 Hızlı Başlangıç', value: '/register ile kayıt ol, /leaderboard kategori:seviye ile sıralamayı gör, /oda ile özel oda menüsünü aç.', inline: false },
      { name: '📝 Register', value: '/register isim yaş cinsiyet ve /register-roller komutlarını kullan.', inline: false },
      { name: '🛡️ Moderasyon', value: '/uyar, /uyarilar, /uyarisil, /filtre ve /hosgeldin komutları kullanılabilir.', inline: false },
      { name: '📊 Seviye ve Leaderboard', value: '/seviye, /seviye-siralama, /leaderboard ve /leaderboard-panel komutları kullanılabilir.', inline: false },
      { name: '🎧 Özel Ses Odası', value: '/oda, /oda-kategori, /oda-devret, /oda-kilitle ve /oda-limit komutları kullanılabilir.', inline: false },
      { name: '🎭 Roller', value: '/roller, /roller-menu, /roller-ekle ve /roller-sil komutları kullanılabilir.', inline: false },
      { name: '🎲 Diğer', value: '/blackjack, /bakiye ve /gunluk komutları kullanılabilir.', inline: false },
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

function buildRoomMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('🎧 Özel Oda Oluşturma')
    .setDescription('Özel odanı oluşturmak için butona basabilir veya aşağıdaki ses kanalına girebilirsin.')
    .setColor(0x2B2D31)
    .addFields({ name: '🔊 Otomatik Oluşturma', value: '`Özel Oda için Tıkla!` ses kanalına girince oda otomatik açılır.', inline: false })
    .setFooter({ text: 'Oda boş kalınca otomatik silinir.' });
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
  if (!guild) return;

  const roomCategoryName = 'Özel Oda';
  let roomCategory = null;
  const savedRoomCategoryId = getCategoryId(guild.id, 'room');
  const savedRoomCategory = savedRoomCategoryId ? guild.channels.cache.get(savedRoomCategoryId) : null;
  if (savedRoomCategory?.type === ChannelType.GuildCategory) roomCategory = savedRoomCategory;
  if (!roomCategory) {
    roomCategory = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === roomCategoryName) || null;
  }
  if (!roomCategory) {
    roomCategory = await guild.channels.create({ name: roomCategoryName, type: ChannelType.GuildCategory, reason: 'Özel oda kategorisi oluşturuluyor.' });
  }
  saveCategoryId(guild.id, 'room', roomCategory.id);

  let roomChannel = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && ['özel-oda', 'oda-menusu'].includes(channel.name)
  ) || null;
  if (!roomChannel) {
    roomChannel = await guild.channels.create({ name: 'özel-oda', type: ChannelType.GuildText, parent: roomCategory.id, reason: 'Özel oda oluşturma kanalı oluşturuluyor.' });
  } else if (roomChannel.parentId !== roomCategory.id) {
    await roomChannel.setParent(roomCategory.id).catch(() => null);
  }
  const botMember = guild.members.me || await guild.members.fetch(client.user.id).catch(() => null);
  if (botMember) {
    await roomChannel.permissionOverwrites.edit(botMember.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
    }).catch((error) => printError('Özel oda panel izinleri ayarlanamadı', error));
  }

  let triggerChannel = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildVoice && channel.name === 'Özel Oda için Tıkla!' && channel.parentId === roomCategory.id
  ) || null;
  if (!triggerChannel) {
    triggerChannel = await guild.channels.create({
      name: 'Özel Oda için Tıkla!',
      type: ChannelType.GuildVoice,
      parent: roomCategory.id,
      reason: 'Özel oda giriş kanalı oluşturuluyor.',
    });
  }

  const messages = await roomChannel.messages.fetch({ limit: 50 }).catch(() => null);
  const existingMessage = messages?.find((message) => message.author.id === client.user.id && [
    '🎧 Özel Oda Oluşturma',
    'Özel Oda Sistemi',
    '# MOREA Özel Oda Kontrol Paneli',
  ].includes(message.embeds[0]?.title));
  const payload = { embeds: [buildRoomManagementEmbed()], components: buildRoomManagementComponents() };
  if (existingMessage) await existingMessage.edit(payload);
  else await roomChannel.send(payload);

  return { roomCategory, roomChannel, triggerChannel };
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

function buildRoomManagementEmbed() {
  return new EmbedBuilder()
    .setTitle('# MOREA Özel Oda Kontrol Paneli')
    .setDescription('Özel odanı aşağıdaki seçeneklerle yönetebilirsin.')
    .setColor(0x2B2D31)
    .addFields(
      { name: '➕ ### Üye Ekle', value: 'Özel odana istediğin kullanıcıyı ekler.', inline: false },
      { name: '➖ ### Üye Çıkar', value: 'Kullanıcının özel odana giriş iznini kaldırır.', inline: false },
      { name: '# ### Oda Limiti', value: 'Özel odanın kişi sınırını değiştirir.', inline: false },
      { name: '🔒 ### Kilitle / Aç', value: 'Özel odanı kilitler veya yeniden açar.', inline: false },
      { name: '🔄 ### Oda İsmi', value: 'Özel odanın ismini istediğin gibi değiştirir.', inline: false }
    )
    .setFooter({ text: 'Önce 🔊 Özel Oda Oluştur ses kanalına girerek özel odanı oluştur.' });
}

function buildRoomManagementComponents(voiceChannelId = null) {
  const suffix = voiceChannelId ? ':' + voiceChannelId : '';
  const button = (action, label, style, emoji) => new ButtonBuilder()
    .setCustomId('room-action:' + action + suffix)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);
  return [
    new ActionRowBuilder().addComponents(button('add', 'Üye Ekle', ButtonStyle.Success, '➕')),
    new ActionRowBuilder().addComponents(button('remove', 'Üye Çıkar', ButtonStyle.Danger, '➖')),
    new ActionRowBuilder().addComponents(button('limit', 'Limit', ButtonStyle.Primary, '#️⃣')),
    new ActionRowBuilder().addComponents(button('lock', 'Kilitle / Aç', ButtonStyle.Secondary, '🔒')),
    new ActionRowBuilder().addComponents(button('name', 'İsim', ButtonStyle.Secondary, '🔄')),
  ];
}

async function refreshRoomManagementPanel(guild) {
  const panelChannel = guild?.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && ['özel-oda', 'oda-menusu'].includes(channel.name)
  );
  if (panelChannel) await ensureRoomManagementPanel(panelChannel, null, null);
}

async function handleRoomActionButton(interaction) {
  const [, action, explicitRoomChannelId] = interaction.customId.split(':');
  const roomInfo = explicitRoomChannelId
    ? getRoomOwnerMap().get(explicitRoomChannelId)
    : [...getRoomOwnerMap().values()].find((info) => info.guildId === interaction.guild?.id && info.ownerId === interaction.user.id);
  const roomChannelId = roomInfo?.channelId || explicitRoomChannelId;
  const voiceChannel = interaction.guild?.channels.cache.get(roomChannelId);
  if (!interaction.guild || !roomInfo || roomInfo.ownerId !== interaction.user.id) {
    await interaction.reply({ content: '❌ Önce Özel Oda Oluştur ses kanalına girerek özel odanı oluşturmalısın.', ephemeral: true });
    return;
  }
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({ content: '❌ Ses odası artık bulunamıyor.', ephemeral: true });
    return;
  }
  if (action === 'add' || action === 'remove' || action === 'transfer') {
    const selectId = action === 'transfer' ? 'room-transfer:' + roomChannelId : 'room-members-' + action + ':' + roomChannelId;
    const placeholder = action === 'add' ? 'Odaya kullanıcı seç' : action === 'remove' ? 'Odadan çıkarılacak kullanıcıyı seç' : 'Yeni oda sahibini seç';
    const select = new UserSelectMenuBuilder().setCustomId(selectId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1);
    await interaction.reply({ content: action === 'transfer' ? 'Yeni oda sahibini seç.' : action === 'add' ? 'Odaya eklenecek kullanıcıyı seç.' : 'Odadan çıkarılacak kullanıcıyı seç.', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    return;
  }
  if (action === 'limit') {
    const input = new TextInputBuilder().setCustomId('room-limit-input').setLabel('Kişi limiti (0-99)').setPlaceholder(String(voiceChannel.userLimit || 0)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
    const modal = new ModalBuilder().setCustomId('room-limit-modal:' + roomChannelId).setTitle('Oda Limitini Ayarla').addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
  if (action === 'name') {
    const currentName = voiceChannel.name.replace(/ · .+$/, '');
    const input = new TextInputBuilder().setCustomId('room-name-input').setLabel('Oda ismi').setValue(currentName.slice(0, 50)).setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(50);
    const modal = new ModalBuilder().setCustomId('room-name-modal:' + roomChannelId).setTitle('Oda İsmini Değiştir').addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  }
  if (action === 'lock') {
    const everyone = voiceChannel.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id);
    const locked = !everyone?.deny.has(PermissionsBitField.Flags.Connect);
    await voiceChannel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, { Connect: locked ? false : true, ViewChannel: true });
    await refreshRoomManagementPanel(interaction.guild);
    await interaction.reply({ content: locked ? '🔒 Oda kilitlendi.' : '🔓 Odanın kilidi açıldı.', ephemeral: true });
  }
}

async function handleRoomLimitModal(interaction, roomChannelId) {
  const roomInfo = getRoomOwnerMap().get(roomChannelId);
  const room = interaction.guild?.channels.cache.get(roomChannelId);
  if (!roomInfo || roomInfo.ownerId !== interaction.user.id || !room || room.type !== ChannelType.GuildVoice) return interaction.reply({ content: '❌ Bu işlem için oda sahibi olmalısın.', ephemeral: true });
  const limit = Number.parseInt(interaction.fields.getTextInputValue('room-limit-input').trim(), 10);
  if (!Number.isInteger(limit) || limit < 0 || limit > 99) return interaction.reply({ content: '❌ Limit 0 ile 99 arasında olmalı.', ephemeral: true });
  await room.setUserLimit(limit);
  await ensureRoomManagementPanel(getRoomControlChannel(interaction.guild, roomInfo), room, roomInfo);
  return interaction.reply({ content: '✅ Oda limiti ' + limit + ' olarak ayarlandı.', ephemeral: true });
}

async function handleRoomNameModal(interaction, roomChannelId) {
  const roomInfo = getRoomOwnerMap().get(roomChannelId);
  const room = interaction.guild?.channels.cache.get(roomChannelId);
  if (!roomInfo || roomInfo.ownerId !== interaction.user.id || !room || room.type !== ChannelType.GuildVoice) return interaction.reply({ content: '❌ Bu işlem için oda sahibi olmalısın.', ephemeral: true });
  const name = interaction.fields.getTextInputValue('room-name-input').trim();
  if (name.length < 2 || name.length > 50 || /[\r\n]/.test(name)) return interaction.reply({ content: '❌ Oda ismi 2-50 karakter arasında olmalı.', ephemeral: true });
  await room.setName(name + ' · ' + interaction.user.username);
  roomInfo.roomName = name;
  getRoomOwnerMap().set(roomChannelId, roomInfo);
  await ensureRoomManagementPanel(getRoomControlChannel(interaction.guild, roomInfo), room, roomInfo);
  return interaction.reply({ content: '✅ Oda ismi güncellendi.', ephemeral: true });
}

async function ensureRoomManagementPanel(controlChannel, voiceChannel, roomInfo) {
  if (!controlChannel || controlChannel.type !== ChannelType.GuildText) {
    return;
  }

  const messages = await controlChannel.messages.fetch({ limit: 50 }).catch(() => null);
  const existingMessage = messages?.find((message) =>
    message.author.id === client.user.id && (message.embeds[0]?.title === '🎧 Oda Yönetimi' || message.embeds[0]?.title === 'Özel Oda Sistemi')
  );
  const payload = {
    embeds: [buildRoomManagementEmbed(roomInfo, voiceChannel)],
    components: buildRoomManagementComponents(voiceChannel.id, voiceChannel),
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

async function createPrivateRoom(guild, member, requestedName = 'Özel Oda', userLimit = 0) {
  const roomOwnerMap = getRoomOwnerMap();
  const existingRoom = guild.channels.cache.find((channel) => getPrivateRoomOwnerId(channel) === member.user.id);
  if (existingRoom) {
    const existingInfo = roomOwnerMap.get(existingRoom.id) || { ownerId: member.user.id, channelId: existingRoom.id, guildId: guild.id, roomName: existingRoom.name, controlChannelId: null };
    roomOwnerMap.set(existingRoom.id, existingInfo);
    return { room: existingRoom, controlChannel: null, existing: true };
  }

  await ensureRoomMenu(guild);
  const savedRoomCategoryId = getCategoryId(guild.id, 'room');
  const savedRoomCategory = savedRoomCategoryId ? guild.channels.cache.get(savedRoomCategoryId) : null;
  const roomCategory = savedRoomCategory?.type === ChannelType.GuildCategory ? savedRoomCategory : null;
  const safeName = String(requestedName || 'Özel Oda').trim().slice(0, 50) || 'Özel Oda';
  const safeLimit = Number.isInteger(userLimit) && userLimit >= 0 && userLimit <= 99 ? userLimit : 0;
  const roomOptions = {
    name: safeName,
    type: ChannelType.GuildVoice,
    userLimit: safeLimit,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.Connect] },
      { id: member.user.id, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel] },
    ],
    reason: member.user.tag + ' özel ses odası oluşturdu.',
  };
  if (roomCategory) roomOptions.parent = roomCategory.id;
  const room = await guild.channels.create(roomOptions);
  await room.setName(safeName + ' · ' + member.user.username).catch(() => null);
  const roomInfo = { ownerId: member.user.id, channelId: room.id, guildId: guild.id, roomName: safeName, controlChannelId: null };
  roomOwnerMap.set(room.id, roomInfo);
  return { room, controlChannel: null, existing: false };
}

async function handleRoomCreateModal(interaction) {
  const roomName = interaction.fields.getTextInputValue('room-name').trim();
  const rawLimit = interaction.fields.getTextInputValue('room-limit').trim();
  const userLimit = Number.parseInt(rawLimit, 10);
  try {
    const result = await createPrivateRoom(interaction.guild, interaction.member, roomName, Number.isInteger(userLimit) ? userLimit : 0);
    if (result.existing) {
      await interaction.reply({ content: '🎧 Zaten açık bir odan var: ' + result.room, ephemeral: true });
      return;
    }
    await interaction.reply({ content: '🎧 Oda hazır: ' + result.room + (result.controlChannel ? '\n🛠️ Yönetim sohbeti: ' + result.controlChannel : ''), ephemeral: true });
  } catch (error) {
    console.error('Oda oluşturma hatası:', error);
    await interaction.reply({ content: '⚠️ Oda oluşturulurken bir hata oluştu.', ephemeral: true });
  }
}

async function ensurePrivateRoomForTrigger(oldState, newState) {
  if (!newState.guild || !newState.channelId || oldState.channelId === newState.channelId || newState.member?.user?.bot) return;
  const categoryId = getCategoryId(newState.guild.id, 'room');
  const trigger = newState.guild.channels.cache.get(newState.channelId);
  if (!trigger || trigger.type !== ChannelType.GuildVoice || trigger.name !== 'Özel Oda için Tıkla!' || (categoryId && trigger.parentId !== categoryId)) return;
  const member = newState.member || await newState.guild.members.fetch(newState.id).catch(() => null);
  if (!member) return;
  try {
    const result = await createPrivateRoom(newState.guild, member);
    if (result?.room && member.voice.channelId === trigger.id) await member.voice.setChannel(result.room).catch(() => null);
  } catch (error) {
    console.error('Otomatik özel oda oluşturma hatası:', error.message);
  }
}

async function checkPrivateRoomAutoClose(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild || (!oldState.channelId && !newState.channelId)) return;

  const roomOwnerMap = getRoomOwnerMap();
  const roomInfo = [oldState.channelId, newState.channelId]
    .filter(Boolean)
    .map((channelId) => roomOwnerMap.get(channelId))
    .find(Boolean);
  if (!roomInfo || roomInfo.closing) return;

  await new Promise((resolve) => setTimeout(resolve, 500));
  const channel = guild.channels.cache.get(roomInfo.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice || channel.members.size > 0) return;

  roomInfo.closing = true;
  roomOwnerMap.set(roomInfo.channelId, roomInfo);
  try {
    await deletePrivateRoom(roomInfo, channel, 'Özel oda boş kaldığı için kapatıldı.');
  } catch (error) {
    roomInfo.closing = false;
    roomOwnerMap.set(roomInfo.channelId, roomInfo);
    console.error('Özel oda kapatma hatası:', error);
  }
}

async function handleRoomCommand(message) {
  if (!message.guild) {
    await message.reply('Bu komut bir sunucuda kullanılmalıdır.');
    return;
  }

  await ensureRoomMenu(message.guild);
  await message.reply({ content: '🎧 Özel oda kontrol paneli `#özel-oda` kanalında hazır!' });
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
    status: 'dnd',
    activities: [{ name: '🔊 Ses kanalına girerek özel oda oluştur', type: 3 }],
  });
  printBanner(client);

  for (const guild of client.guilds.cache.values()) {
    try {
      await updateGuildInviteSnapshot(guild);
      restorePrivateRoomOwners(guild);
      // Özel odalar artık ayrı metin kanalı oluşturmaz; tek panel #özel-oda kanalındadır.
      await ensureRoomMenu(guild);
      await keepBotInConfiguredVoiceChannel(guild);
      await ensureRoleMenu(guild);
    } catch (error) {
      printError(`[${guild.name}] başlangıç ayarı tamamlanamadı`, error);
    }
  }

  printSuccess('Discord bağlantısı hazır • Prefix: . • Yardım: .help');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) {
    return;
  }

  const content = message.content.slice(PREFIX.length).trim();
  const [command, ...args] = content.split(/\s+/);

  if (command === 'oda') {
    await handleRoomCommand(message);
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


    if (interaction.customId.startsWith('room-action:')) {
      await handleRoomActionButton(interaction);
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

  }

  if (interaction.isUserSelectMenu() && (interaction.customId.startsWith('room-members-') || interaction.customId.startsWith('room-transfer:'))) {
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

    if (action === 'room-transfer') {
      const targetId = interaction.values[0];
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!target || target.user.bot || target.id === roomInfo.ownerId) {
        await interaction.reply({ content: '❌ Geçerli bir kullanıcı seçmelisin.', ephemeral: true });
        return;
      }
      const otherRoom = [...interaction.guild.channels.cache.values()].find((channel) => channel.id !== roomChannelId && getPrivateRoomOwnerId(channel) === target.id);
      if (otherRoom) {
        await interaction.reply({ content: '❌ Bu kullanıcının zaten aktif bir özel odası var.', ephemeral: true });
        return;
      }
      await voiceChannel.permissionOverwrites.edit(roomInfo.ownerId, { Connect: false, ViewChannel: false });
      await voiceChannel.permissionOverwrites.edit(target.id, { Connect: true, ViewChannel: true });
      const controlChannel = getRoomControlChannel(interaction.guild, roomInfo);
      if (controlChannel) {
        await controlChannel.permissionOverwrites.edit(roomInfo.ownerId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: false });
        await controlChannel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      }
      const baseName = voiceChannel.name.replace(/ · .+$/, '');
      await voiceChannel.setName(baseName + ' · ' + target.user.username).catch(() => {});
      roomInfo.ownerId = target.id;
      roomInfo.roomName = baseName;
      roomInfo.controlChannelId = controlChannel?.id || roomInfo.controlChannelId || null;
      getRoomOwnerMap().set(roomChannelId, roomInfo);
      await ensureRoomManagementPanel(controlChannel, voiceChannel, roomInfo);
      await interaction.update({ content: '✅ Özel oda sahipliği <@' + target.id + '> kullanıcısına devredildi.', components: [] });
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

    if (interaction.customId.startsWith('room-limit-modal:')) {
      await handleRoomLimitModal(interaction, interaction.customId.split(':')[1]);
      return;
    }

    if (interaction.customId.startsWith('room-name-modal:')) {
      await handleRoomNameModal(interaction, interaction.customId.split(':')[1]);
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

});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.guild) return;
  if (newState.id === client.user?.id) {
    const target = getConfiguredBotVoiceChannel(newState.guild);
    if (target && newState.channelId !== target.id) {
      await keepBotInConfiguredVoiceChannel(newState.guild);
    }
  }
  await ensurePrivateRoomForTrigger(oldState, newState);
  await checkPrivateRoomAutoClose(oldState, newState);
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

function slashMessageAdapter(interaction, { channel = null, role = null, attachment = null, args = [] } = {}) {
  return {
    guild: interaction.guild,
    member: interaction.member,
    channel: interaction.channel,
    author: interaction.user,
    user: interaction.user,
    args,
    mentions: { channels: { first: () => channel }, roles: { first: () => role } },
    attachments: { first: () => attachment },
    reply: (payload) => interaction.reply(typeof payload === 'string' ? { content: payload } : payload),
  };
}

async function handleRoleAddSlashCommand(interaction) {
  const role = interaction.options.getRole('rol');
  const category = interaction.options.getString('kategori');
  return handleRoleAddCommand(slashMessageAdapter(interaction, { role, args: [role?.name || 'rol', category || ''] }), [role?.name || 'rol', category || '']);
}
async function handleRoleRemoveSlashCommand(interaction) {
  const role = interaction.options.getRole('rol');
  return handleRoleRemoveCommand(slashMessageAdapter(interaction, { role }));
}
async function handleRoomSlashCommand(interaction) { return handleRoomCommand(slashMessageAdapter(interaction)); }
async function handleRoomCategorySlashCommand(interaction) {
  if (!interaction.guild) return interaction.reply({ content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const canManage = interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageChannels) || interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!canManage) return interaction.reply({ content: '❌ Bu komut için Kanalları Yönet veya Sunucuyu Yönet izni gerekir.', ephemeral: true });
  const category = interaction.options.getChannel('kategori');
  if (!category || category.type !== ChannelType.GuildCategory) return interaction.reply({ content: '❌ Geçerli bir kategori seçmelisin.', ephemeral: true });
  saveCategoryId(interaction.guild.id, 'room', category.id);
  return interaction.reply({ content: '✅ Özel ses odalarının kategorisi ' + category + ' olarak ayarlandı.' });
}
async function handleRoleSlashCommand(interaction) { return handleRoleCommand(slashMessageAdapter(interaction)); }
async function handleRoleMenuSlashCommand(interaction) { return handleRoleMenuCommand(slashMessageAdapter(interaction)); }
async function handleHelpSlashCommand(interaction) { return handleHelpCommand(slashMessageAdapter(interaction)); }

require('./v2').initializeV3({
  client,
  rest,
  sendLog: async () => {},
  commandHandlers: {
    oda: handleRoomSlashCommand,
    'oda-kategori': handleRoomCategorySlashCommand,
    roller: handleRoleSlashCommand,
    help: handleHelpSlashCommand,
    'roller-ekle': handleRoleAddSlashCommand,
    'roller-sil': handleRoleRemoveSlashCommand,
    'roller-menu': handleRoleMenuSlashCommand,
  },
});

client.login(discordToken).catch((error) => {
  console.error('Bot giriş başarısız:', error.message);
  process.exit(1);
});
