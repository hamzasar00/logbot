const {
  Events,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  getGuild,
  updateGuildSection,
  addWarning,
  getWarnings,
  clearWarnings,
  recordStat,
  getStats,
  getLeaderboard,
  getLevelConfig,
  addLevelXp,
  getLevelUser,
  getLevelLeaderboard,
  setLevelReward,
  removeLevelReward,
  xpForLevel,
  saveState,
} = require('./v2-db');

const spamBuckets = new Map();
const voiceStarted = new Map();
const inviteSnapshots = new Map();
const levelCooldowns = new Map();
const blackjackGames = new Map();
const BLACKJACK_TIMEOUT_MS = 5 * 60 * 1000;

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

async function snapshotInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return false;
  const snapshot = new Map();
  for (const invite of invites.values()) snapshot.set(invite.code, invite.uses ?? 0);
  inviteSnapshots.set(guild.id, snapshot);
  return true;
}

async function detectInviterId(guild) {
  const previous = inviteSnapshots.get(guild.id);
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const current = new Map();
  let inviterId = null;
  for (const invite of invites.values()) {
    const uses = invite.uses ?? 0;
    current.set(invite.code, uses);
    if (previous && !inviterId && uses > (previous.get(invite.code) ?? 0)) inviterId = invite.inviterId ?? null;
  }
  inviteSnapshots.set(guild.id, current);
  return inviterId;
}

function formatMessage(text, member) {
  return String(text || '')
    .replaceAll('{user}', '<@' + member.id + '>')
    .replaceAll('{username}', member.user?.username || member.displayName || 'Üye')
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount))
    .slice(0, 2000);
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



async function ensureBlackjackChannel(guild) {
  const config = getGuild(guild.id).blackjack;
  let channel = config.channelId ? await guild.channels.fetch(config.channelId).catch(() => null) : null;
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((candidate) => candidate.type === ChannelType.GuildText && candidate.name === 'blackjack') || null;
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: 'blackjack',
      type: ChannelType.GuildText,
      topic: '🃏 Sunucu Blackjack odası — .blackjack ile oyun başlat.',
      reason: 'Kalıcı Blackjack oyun odası oluşturuluyor',
    }).catch((error) => {
      console.error('Blackjack odası oluşturulamadı:', error.message);
      return null;
    });
  }
  if (channel && config.channelId !== channel.id) updateGuildSection(guild.id, 'blackjack', { channelId: channel.id });
  return channel;
}

const BLACKJACK_SUITS = ['♠', '♥', '♦', '♣'];
const BLACKJACK_RANKS = [
  { label: 'A', value: 11 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
  { label: '6', value: 6 },
  { label: '7', value: 7 },
  { label: '8', value: 8 },
  { label: '9', value: 9 },
  { label: '10', value: 10 },
  { label: 'J', value: 10 },
  { label: 'Q', value: 10 },
  { label: 'K', value: 10 },
];

function createBlackjackDeck() {
  const deck = [];
  for (const suit of BLACKJACK_SUITS) {
    for (const rank of BLACKJACK_RANKS) deck.push({ label: rank.label + suit, value: rank.value });
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function blackjackScore(cards) {
  let total = cards.reduce((sum, card) => sum + card.value, 0);
  let aces = cards.filter((card) => card.label.startsWith('A')).length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function blackjackCards(cards, hideFirst = false) {
  return cards.map((card, index) => hideFirst && index === 0 ? '[ 🂠 ]' : '[ ' + card.label + ' ]').join('  ');
}

function blackjackProgress(score) {
  const safeScore = Math.min(21, Math.max(0, score));
  const filled = Math.round((safeScore / 21) * 10);
  return '🟦'.repeat(filled) + '⬛'.repeat(10 - filled) + ' ' + score + '/21';
}

function blackjackButtons(userId, finished = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('blackjack:hit:' + userId).setLabel('Kart çek').setEmoji('🃏').setStyle(ButtonStyle.Primary).setDisabled(finished),
    new ButtonBuilder().setCustomId('blackjack:stand:' + userId).setLabel('Dur').setEmoji('🛑').setStyle(ButtonStyle.Success).setDisabled(finished)
  );
  if (finished) row.addComponents(new ButtonBuilder().setCustomId('blackjack:new:' + userId).setLabel('Yeni oyun').setEmoji('🔄').setStyle(ButtonStyle.Secondary));
  return row;
}

function blackjackEmbed(game, finished = false, resultText = '') {
  const playerScore = blackjackScore(game.player);
  const dealerScore = blackjackScore(game.dealer);
  const status = resultText || 'Hamleni seç: kart çek veya dur.';
  const color = finished ? (resultText?.includes('Kazandın') || resultText?.includes('21 yaptın') ? 0x22C55E : resultText?.includes('patladı') || resultText?.includes('kaybettin') ? 0xEF4444 : 0xF59E0B) : 0x7C3AED;
  const mono = String.fromCharCode(96).repeat(3);
  const lineBreak = String.fromCharCode(10);
  const table = mono + lineBreak + '╭──────── 🃏 BLACKJACK MASASI ────────╮' + lineBreak +
    '│ 🏦 DAĞITICI  ' + (finished ? String(dealerScore).padStart(2, ' ') : ' ?') + '  ' + blackjackCards(game.dealer, !finished) + lineBreak +
    '│ 🎯 OYUNCU    ' + String(playerScore).padStart(2, ' ') + '  ' + blackjackCards(game.player) + lineBreak +
    '╰─────────────────────────────────────╯' + lineBreak + mono;
  return new EmbedBuilder()
    .setTitle('♠️♥️  BLACKJACK  ♦️♣️')
    .setDescription(table + lineBreak + '🎯 Senin ilerlemen' + lineBreak + blackjackProgress(playerScore))
    .setColor(color)
    .addFields(
      { name: '🎯 Oyuncu eli', value: blackjackCards(game.player) + lineBreak + 'Toplam: **' + playerScore + '**', inline: true },
      { name: '🏦 Dağıtıcı eli', value: blackjackCards(game.dealer, !finished) + lineBreak + 'Toplam: **' + (finished ? dealerScore : '?') + '**', inline: true },
      { name: '📌 Durum', value: status, inline: false }
    )
    .setFooter({ text: finished ? 'Oyun tamamlandı · Yeni oyun butonuna basabilirsin' : '5 dakika içinde hamle yap · Bahis yok, sadece eğlence' });
}

function blackjackResult(game) {
  const playerScore = blackjackScore(game.player);
  const dealerScore = blackjackScore(game.dealer);
  const playerNatural = playerScore === 21 && game.player.length === 2;
  const dealerNatural = dealerScore === 21 && game.dealer.length === 2;
  if (playerScore > 21) return '💥 Elin patladı. Kaybettin.';
  if (dealerScore > 21) return '🎉 Dağıtıcının eli patladı. Kazandın!';
  if (playerNatural && !dealerNatural) return '🃏 Blackjack! Kazandın!';
  if (dealerNatural && !playerNatural) return '😕 Dağıtıcı blackjack yaptı.';
  if (playerScore > dealerScore) return '🎉 Kazandın!';
  if (playerScore < dealerScore) return '😕 Dağıtıcı kazandı.';
  return '🤝 Berabere.';
}

async function finishBlackjack(interaction, game, resultText) {
  clearTimeout(game.timeout);
  blackjackGames.delete(game.key);
  return interaction.update({ embeds: [blackjackEmbed(game, true, resultText)], components: [blackjackButtons(game.userId, true)] });
}

async function startBlackjackCommand(context) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const blackjackChannel = await ensureBlackjackChannel(guild);
  if (!blackjackChannel) return respond(context, { content: '❌ Blackjack odası oluşturulamadı. Botun kanal oluşturma iznini kontrol et.', ephemeral: true });
  if (context.channelId !== blackjackChannel.id) return respond(context, { content: '🃏 Blackjack oyununu ' + blackjackChannel + ' kanalında oynayabilirsin.', ephemeral: true });
  const user = isInteraction(context) ? context.user : context.author;
  const key = guild.id + ':' + user.id;
  if (blackjackGames.has(key)) return respond(context, { content: 'Zaten devam eden bir blackjack oyunun var.', ephemeral: true });
  const deck = createBlackjackDeck();
  const game = { key, userId: user.id, username: user.username || user.tag || 'Oyuncu', deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()] };
  blackjackGames.set(key, game);
  game.timeout = setTimeout(() => blackjackGames.delete(key), BLACKJACK_TIMEOUT_MS);
  return respond(context, { embeds: [blackjackEmbed(game)], components: [blackjackButtons(user.id)] });
}

async function handleBlackjackButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) return interaction.reply({ content: 'Bu blackjack oyunu başka bir kullanıcıya ait.', ephemeral: true });
  const key = interaction.guild.id + ':' + ownerId;
  const game = blackjackGames.get(key);
  if (action === 'new') return startBlackjackCommand(interaction);
  if (!game) return interaction.reply({ content: 'Bu blackjack oyununun süresi dolmuş. Yeni oyun için .blackjack yaz.', ephemeral: true });
  if (action === 'hit') {
    game.player.push(game.deck.pop());
    const score = blackjackScore(game.player);
    if (score > 21) return finishBlackjack(interaction, game, '💥 Elin patladı. Kaybettin.');
    if (score === 21) {
      while (blackjackScore(game.dealer) < 17 && game.deck.length) game.dealer.push(game.deck.pop());
      return finishBlackjack(interaction, game, blackjackResult(game));
    }
    return interaction.update({ embeds: [blackjackEmbed(game)], components: [blackjackButtons(ownerId)] });
  }
  if (action === 'stand') {
    while (blackjackScore(game.dealer) < 17 && game.deck.length) game.dealer.push(game.deck.pop());
    return finishBlackjack(interaction, game, blackjackResult(game));
  }
  return interaction.reply({ content: 'Geçersiz blackjack hamlesi.', ephemeral: true });
}

async function levelCommand(context) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const args = isInteraction(context) ? [] : argsOf(context);
  const action = isInteraction(context) ? 'profil' : (args[0] || 'profil').toLocaleLowerCase('tr-TR');
  const config = getLevelConfig(guild.id);
  if (['ac', 'aç', 'kapat', 'ayar', 'ödül', 'odul', 'ödül-sil', 'odul-sil'].includes(action)) {
    if (!isManager(context.member)) return respond(context, { content: 'Bu işlem için Sunucuyu Yönet veya Yönetici yetkisi gerekir.', ephemeral: true });
    if (action === 'ac' || action === 'aç' || action === 'kapat') {
      updateGuildSection(guild.id, 'levels', { enabled: action !== 'kapat' });
      return respond(context, { content: '✅ Seviye sistemi ' + (action === 'kapat' ? 'kapatıldı.' : 'açıldı.'), ephemeral: true });
    }
    if (action === 'ayar') {
      const setting = args[1]?.toLocaleLowerCase('tr-TR');
      const value = Number(args[2]);
      if (setting === 'xp' && Number.isInteger(value) && value >= 1 && value <= 100) {
        updateGuildSection(guild.id, 'levels', { xpPerMessage: value });
        return respond(context, { content: '✅ Mesaj başına XP ' + value + ' olarak ayarlandı.', ephemeral: true });
      }
      if (setting === 'cooldown' && Number.isInteger(value) && value >= 5 && value <= 3600) {
        updateGuildSection(guild.id, 'levels', { cooldownSeconds: value });
        return respond(context, { content: '✅ XP cooldown süresi ' + value + ' saniye olarak ayarlandı.', ephemeral: true });
      }
      if (setting === 'duyuru') {
        const channel = channelOf(context);
        updateGuildSection(guild.id, 'levels', { announcementChannelId: channel?.id || null, announce: Boolean(channel) });
        return respond(context, { content: channel ? '✅ Seviye duyuruları ' + channel + ' kanalına ayarlandı.' : '✅ Seviye duyuruları kapatıldı.', ephemeral: true });
      }
      return respond(context, { content: 'Kullanım: .seviye ayar xp 15, .seviye ayar cooldown 60 veya .seviye ayar duyuru #kanal.', ephemeral: true });
    }
    const level = Number(args[1]);
    if (action === 'ödül' || action === 'odul') {
      const role = roleOf(context);
      if (!Number.isInteger(level) || !role || !setLevelReward(guild.id, level, role.id)) return respond(context, { content: 'Kullanım: .seviye ödül 5 @Rol.', ephemeral: true });
      return respond(context, { content: '✅ Seviye ' + level + ' ödülü ' + role + ' olarak ayarlandı.', ephemeral: true });
    }
    if (Number.isInteger(level) && removeLevelReward(guild.id, level)) return respond(context, { content: '✅ Seviye ' + level + ' ödülü kaldırıldı.', ephemeral: true });
    return respond(context, { content: 'Kullanım: .seviye ödül-sil 5.', ephemeral: true });
  }
  if (action === 'sıralama' || action === 'siralama' || action === 'leaderboard') return levelLeaderboardCommand(context);
  const target = isInteraction(context) ? (context.options.getUser('user') || context.user) : (targetOf(context) || context.author);
  if (!config.enabled && !isManager(context.member)) return respond(context, { content: 'Seviye sistemi kapalı. Yönetici .seviye ac komutuyla açabilir.', ephemeral: true });
  const user = getLevelUser(guild.id, target.id);
  const nextXp = xpForLevel(user.level + 1);
  const member = await memberOf(guild, target.id);
  const displayName = member?.displayName || target.username || 'Kullanıcı';
  return respond(context, { embeds: [new EmbedBuilder().setTitle('🎖️ ' + displayName + ' seviye profili').setThumbnail(target.displayAvatarURL?.({ size: 128 }) || null).setColor(0x8B5CF6).addFields(
    { name: 'Seviye', value: String(user.level), inline: true },
    { name: 'XP', value: user.xp + ' / ' + nextXp, inline: true },
    { name: 'Mesaj', value: String(user.messages), inline: true },
    { name: 'Sonraki seviye', value: Math.max(0, nextXp - user.xp) + ' XP kaldı.' }
  )] });
}

async function levelLeaderboardCommand(context) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const config = getLevelConfig(guild.id);
  if (!config.enabled && !isManager(context.member)) return respond(context, { content: 'Seviye sistemi kapalı. Yönetici .seviye ac komutuyla açabilir.', ephemeral: true });
  const requestedLimit = isInteraction(context) ? context.options.getInteger('limit') || 10 : Number(argsOf(context)[1]) || 10;
  const rows = getLevelLeaderboard(guild.id, Math.min(10, Math.max(1, requestedLimit)));
  if (!rows.length) return respond(context, { content: 'Henüz seviye verisi yok.', ephemeral: true });
  const lines = rows.map((row, index) => '**' + (index + 1) + '.** <@' + row.userId + '> — Seviye ' + row.level + ' · ' + row.xp + ' XP');
  return respond(context, { embeds: [new EmbedBuilder().setTitle('🏆 Seviye sıralaması').setDescription(lines.join('\n')).setColor(0xF59E0B)] });
}

async function awardLevelXp(message) {
  const config = getLevelConfig(message.guild.id);
  if (!config.enabled) return;
  const key = message.guild.id + ':' + message.author.id;
  const now = Date.now();
  const last = levelCooldowns.get(key) || 0;
  if (now - last < config.cooldownSeconds * 1000) return;
  levelCooldowns.set(key, now);
  const result = addLevelXp(message.guild.id, message.author.id, config.xpPerMessage);
  if (!result?.leveledUp) return;
  const rewardRoleId = config.rewards[String(result.level)];
  let rewardText = '';
  if (rewardRoleId && message.member) {
    const role = message.guild.roles.cache.get(rewardRoleId);
    if (role && !role.managed) {
      await message.member.roles.add(role).catch(() => {});
      rewardText = ' Ödül rolü: ' + role + '.';
    }
  }
  if (!config.announce) return;
  const channel = config.announcementChannelId ? await textChannel(message.guild, config.announcementChannelId) : message.channel;
  if (channel) await channel.send({ content: '🎉 <@' + message.author.id + '> seviye atladı! Yeni seviye: ' + result.level + '.' + rewardText }).catch(() => {});
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

const leaderboardCategories = {
  metin: { key: 'messages', label: 'Metin', unit: 'mesaj' },
  text: { key: 'messages', label: 'Metin', unit: 'mesaj' },
  ses: { key: 'voiceMinutes', label: 'Ses', unit: 'dakika' },
  voice: { key: 'voiceMinutes', label: 'Ses', unit: 'dakika' },
  davet: { key: 'invites', label: 'Davet', unit: 'davet' },
  invite: { key: 'invites', label: 'Davet', unit: 'davet' },
};

async function buildLeaderboardEmbed(guild) {
  const config = getGuild(guild.id);
  const rows = getLevelLeaderboard(guild.id, 10);
  const statsUsers = config.stats?.users || {};
  const description = rows.length
    ? rows.map((row, index) => {
      const stats = statsUsers[row.userId] || {};
      return '**' + (index + 1) + '.** <@' + row.userId + '> — Seviye **' + row.level + '** · ' + row.xp + ' XP\n' +
        '↳ ' + (stats.messages || row.messages || 0) + ' mesaj · ' + (stats.voiceMinutes || 0) + ' dk ses · ' + (stats.invites || 0) + ' davet';
    }).join('\n')
    : 'Henüz seviye verisi oluşmadı. Seviye sistemi açıldığında istatistikler burada görünecek.';
  return new EmbedBuilder()
    .setTitle('📊 Sunucu Leaderboard')
    .setDescription(description.slice(0, 4000))
    .setColor(0x8B5CF6)
    .setFooter({ text: 'Seviye sistemi · Panel 60 saniyede bir güncellenir' })
    .setTimestamp();
}

async function refreshLeaderboardPanel(guild) {
  const panel = getGuild(guild.id).levels.leaderboard;
  if (!panel.enabled || !panel.channelId) return false;
  const channel = await textChannel(guild, panel.channelId);
  if (!channel) return false;
  const embed = await buildLeaderboardEmbed(guild);
  let message = panel.messageId ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
  if (message) {
    await message.edit({ embeds: [embed] }).catch(() => {});
    return true;
  }
  message = await channel.send({ embeds: [embed] }).catch(() => null);
  if (!message) return false;
  updateGuildSection(guild.id, 'levels', { leaderboard: { enabled: true, channelId: channel.id, messageId: message.id } });
  return true;
}

async function leaderboardPanelCommand(context, action) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  if (!isManager(context.member)) return respond(context, { content: 'Bu işlem için Sunucuyu Yönet veya Yönetici yetkisi gerekir.', ephemeral: true });
  const normalizedAction = String(action || '').toLocaleLowerCase('tr-TR');
  if (normalizedAction === 'kur') {
    const channel = channelOf(context);
    if (!channel || !channel.isTextBased()) return respond(context, { content: 'Kullanım: .leaderboard kur #kanal', ephemeral: true });
    updateGuildSection(guild.id, 'levels', { leaderboard: { enabled: true, channelId: channel.id, messageId: null } });
    const refreshed = await refreshLeaderboardPanel(guild);
    return respond(context, { content: refreshed ? '✅ Leaderboard paneli ' + channel + ' kanalına kuruldu ve otomatik güncellemeler açıldı.' : '❌ Leaderboard mesajı oluşturulamadı. Botun kanalda mesaj gönderme iznini kontrol et.', ephemeral: true });
  }
  const panel = getGuild(guild.id).levels.leaderboard;
  if (normalizedAction === 'yenile') {
    if (!panel.enabled) return respond(context, { content: 'Leaderboard paneli kurulu değil. Önce .leaderboard kur #kanal kullan.', ephemeral: true });
    const refreshed = await refreshLeaderboardPanel(guild);
    return respond(context, { content: refreshed ? '✅ Leaderboard paneli yenilendi.' : '❌ Leaderboard paneli yenilenemedi.', ephemeral: true });
  }
  if (normalizedAction === 'kapat') {
    updateGuildSection(guild.id, 'levels', { leaderboard: { enabled: false } });
    return respond(context, { content: '✅ Leaderboard otomatik güncellemesi kapatıldı. Panel mesajı silinmedi.', ephemeral: true });
  }
  return respond(context, { content: 'Kullanım: .leaderboard kur #kanal, .leaderboard yenile veya .leaderboard kapat', ephemeral: true });
}

async function leaderboardCommand(context) {
  const guild = guildOf(context);
  if (!guild) return respond(context, { content: 'Bu komut bir sunucuda kullanılmalıdır.', ephemeral: true });
  const requested = isInteraction(context) ? context.options.getString('kategori') || 'metin' : argsOf(context)[0] || 'metin';
  const category = leaderboardCategories[requested.toLocaleLowerCase('tr-TR')];
  if (!category) return respond(context, { content: 'Kategori seç: `metin`, `ses` veya `davet`.', ephemeral: true });
  const requestedLimit = isInteraction(context) ? context.options.getInteger('limit') || 10 : Number(argsOf(context)[1]) || 10;
  const limit = Math.min(10, Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : 10));
  const rows = getLeaderboard(guild.id, category.key, limit);
  if (!rows.length) return respond(context, { content: 'Bu kategori için henüz leaderboard verisi yok. Önce `.istatistik ac` ile istatistikleri aç.', ephemeral: true });
  const lines = rows.map((row, index) => {
    const member = guild.members.cache.get(row.userId);
    const name = member?.displayName ? member.displayName + ' (<@' + row.userId + '>)' : '<@' + row.userId + '>';
    return '**' + (index + 1) + '.** ' + name + ' — `' + row.value + ' ' + category.unit + '`';
  });
  return respond(context, { embeds: [new EmbedBuilder().setTitle('🏆 ' + category.label + ' Leaderboard').setDescription(lines.join('\n').slice(0, 3900)).setColor(0xF59E0B)] });
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
  { name: 'leaderboard', description: 'Metin, ses ve davet sıralaması', options: [{ name: 'kategori', description: 'Sıralama türü', type: 3, required: true, choices: [{ name: 'metin', value: 'metin' }, { name: 'ses', value: 'ses' }, { name: 'davet', value: 'davet' }] }, { name: 'limit', description: 'Gösterilecek kişi sayısı', type: 4, min_value: 1, max_value: 10 }] },
  { name: 'leaderboard-panel', description: 'Sabit leaderboard panelini yönetir', options: [{ name: 'eylem', description: 'Panel işlemi', type: 3, required: true, choices: [{ name: 'kur', value: 'kur' }, { name: 'yenile', value: 'yenile' }, { name: 'kapat', value: 'kapat' }] }, { name: 'kanal', description: 'Panel kanalı', type: 7, channel_types: [0] }] },
  { name: 'blackjack', description: 'Blackjack oyna' },
  { name: 'seviye', description: 'Seviye profilini gösterir', options: [{ name: 'user', description: 'Profiline bakılacak kullanıcı', type: 6 }] },
  { name: 'seviye-siralama', description: 'Seviye sıralamasını gösterir', options: [{ name: 'limit', description: 'Gösterilecek kişi sayısı', type: 4, min_value: 1, max_value: 10 }] },
  { name: 'oda-devret', description: 'Özel oda sahipliğini devreder', options: [{ name: 'user', description: 'Yeni sahip', type: 6, required: true }] },
  { name: 'oda-kilitle', description: 'Özel odayı kilitler veya açar' },
  { name: 'oda-limit', description: 'Özel oda limitini değiştirir', options: [{ name: 'limit', description: '0 sınırsızdır', type: 4, required: true, min_value: 0, max_value: 99 }] },
];

function initializeV2({ client, rest, sendLog, commandHandlers = {} }) {
  client.on(Events.MessageCreate, async (message) => {
    try {
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
      if (command === 'blackjack' || command === 'bj') return runV2Command(() => startBlackjackCommand(context), context, command);
      if (['leaderboard', 'leaderbord', 'liderlik', 'liderboard'].includes(command)) {
        const panelAction = ['kur', 'yenile', 'kapat'].includes((args[0] || '').toLocaleLowerCase('tr-TR')) ? args.shift() : null;
        return runV2Command(() => panelAction ? leaderboardPanelCommand(context, panelAction) : leaderboardCommand(context), context, command);
      }
      if (command === 'seviye' || command === 'level') return runV2Command(() => levelCommand(context), context, command);
      if (['seviye-siralama', 'levelboard'].includes(command)) return runV2Command(() => levelLeaderboardCommand(context), context, command);
      if (command === 'oda-devret') return runV2Command(() => roomCommand(context, 'devret'), context, command);
      if (command === 'oda-kilitle') return runV2Command(() => roomCommand(context, 'kilitle'), context, command);
      if (command === 'oda-limit') return runV2Command(() => roomCommand(context, 'limit'), context, command);
    }
    recordStat(message.guild.id, 'messages', 1, message.author.id);
      await applyModeration(message, sendLog).catch((error) => console.error('V2 moderasyon hatası:', error.message));
      await awardLevelXp(message).catch((error) => console.error('V3 seviye XP hatası:', error.message));
    } catch (error) {
      console.error('V2 mesaj handler hatası:', error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('blackjack:')) {
      return handleBlackjackButton(interaction).catch((error) => console.error('Blackjack buton hatası:', error));
    }
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
      if (name === 'leaderboard') return await leaderboardCommand(interaction);
      if (name === 'leaderboard-panel') return await leaderboardPanelCommand(interaction, interaction.options.getString('eylem'));
      if (name === 'blackjack') return await startBlackjackCommand(interaction);
      if (name === 'seviye') return await levelCommand(interaction);
      if (name === 'seviye-siralama') return await levelLeaderboardCommand(interaction);
      if (name === 'oda-devret') return await roomCommand(interaction, 'devret');
      if (name === 'oda-kilitle') return await roomCommand(interaction, 'kilitle');
      if (name === 'oda-limit') return await roomCommand(interaction, 'limit');
    } catch (error) {
      console.error('V2 slash komut hatası:', error);
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Komut çalıştırılırken hata oluştu.', ephemeral: true }).catch(() => {});
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const config = getGuild(member.guild.id);
    recordStat(member.guild.id, 'joins');
      const inviterId = await detectInviterId(member.guild);
      if (inviterId) recordStat(member.guild.id, 'invites', 1, inviterId);
    if (member.user.bot && !config.welcome.includeBots) return;
    if (config.welcome.enabled && config.welcome.channelId) {
      const channel = await textChannel(member.guild, config.welcome.channelId);
      if (channel) await channel.send({ content: formatMessage(config.welcome.message, member) }).catch((error) => console.error('Hoş geldin mesajı gönderilemedi:', error.message));
    }
      if (config.welcome.autoRoleId) await member.roles.add(config.welcome.autoRoleId).catch(() => {});
    } catch (error) {
      console.error('V2 üye katılım handler hatası:', error);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const config = getGuild(member.guild.id);
    recordStat(member.guild.id, 'leaves');
    if (!config.welcome.leaveEnabled || !config.welcome.leaveChannelId) return;
    const channel = await textChannel(member.guild, config.welcome.leaveChannelId);
      if (channel) await channel.send({ content: formatMessage(config.welcome.leaveMessage, member) }).catch((error) => console.error('Ayrılma mesajı gönderilemedi:', error.message));
    } catch (error) {
      console.error('V2 üye ayrılma handler hatası:', error);
    }
  });

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      const key = newState.guild.id + ':' + newState.id;
    if (!oldState.channelId && newState.channelId) voiceStarted.set(key, Date.now());
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const started = voiceStarted.get(key);
      if (started) recordStat(newState.guild.id, 'voiceMinutes', Math.max(1, Math.ceil((Date.now() - started) / 60000)), newState.id);
      if (newState.channelId) voiceStarted.set(key, Date.now());
        else voiceStarted.delete(key);
      }
    } catch (error) {
      console.error('V2 ses istatistik handler hatası:', error);
    }
  });

  client.once(Events.ClientReady, async () => {
    for (const guild of client.guilds.cache.values()) {
      await snapshotInvites(guild);
      await rest.put('/applications/' + client.user.id + '/guilds/' + guild.id + '/commands', { body: slashCommands })
        .catch((error) => console.error('V2 slash komutları kaydedilemedi:', error.message));
      await refreshLeaderboardPanel(guild).catch((error) => console.error('Leaderboard paneli yenilenemedi:', error.message));
      await ensureBlackjackChannel(guild);
    }
    console.log('V2/V3 özellikleri hazır: moderasyon, hoş geldin, özel oda 2.0, istatistik, seviye ve slash komutları.');
  });

  setInterval(() => {
    try {
      saveState();
    } catch (error) {
      console.error('V2 otomatik kayıt hatası:', error);
    }
  }, 30000);

  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await refreshLeaderboardPanel(guild).catch((error) => console.error('Leaderboard otomatik güncelleme hatası:', error.message));
    }
  }, 60000);
}

module.exports = { initializeV2 };