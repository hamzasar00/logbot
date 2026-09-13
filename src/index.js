const { Client, GatewayIntentBits, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Colors, REST, Routes, ChannelSelectMenuBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder, AuditLogEvent, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } = require('discord.js');
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
      { name: '🎧 Özel Ses Odası', value: '/oda, /oda-devret, /oda-kilitle ve /oda-limit komutları kullanılabilir.', inline: false },
      { name: '🎭 Roller', value: '/roller, /roller-menu, /roller-ekle ve /roller-sil komutları kullanılabilir.', inline: false },
      { name: '🎲 Diğer', value: '/blackjack, /bakiye ve /gunluk komutları kullanılabilir.', inline: false },
    );
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
  printBanner(client);

  for (const guild of client.guilds.cache.values()) {
    try {
      await updateGuildInviteSnapshot(guild);
      restorePrivateRoomOwners(guild);
      for (const roomInfo of getRoomOwnerMap().values()) {
        if (roomInfo.guildId !== guild.id) continue;
        try {
          await ensureRoomControlChannel(guild, roomInfo);
        } catch (error) {
          printError('Oda yönetim sohbeti hazırlanamadı', error);
        }
      }
      await ensureRoomMenu(guild);
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

});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.guild) return;
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
async function handleRoleSlashCommand(interaction) { return handleRoleCommand(slashMessageAdapter(interaction)); }
async function handleRoleMenuSlashCommand(interaction) { return handleRoleMenuCommand(slashMessageAdapter(interaction)); }
async function handleHelpSlashCommand(interaction) { return handleHelpCommand(slashMessageAdapter(interaction)); }

require('./v2').initializeV3({
  client,
  rest,
  sendLog: async () => {},
  commandHandlers: {
    oda: handleRoomSlashCommand,
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
