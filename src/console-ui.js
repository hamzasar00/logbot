const useColor = Boolean(process.stdout.isTTY);

const colors = {
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

function paint(color, text) {
  return useColor ? colors[color] + text + colors.reset : text;
}

function printBanner(client) {
  const botName = client.user?.tag || 'Discord Bot';
  const serverCount = client.guilds?.cache?.size ?? 0;
  console.log('');
  console.log(paint('cyan', '╔════════════════════════════════════════════════════════════╗'));
  console.log(paint('cyan', '║') + paint('bold', '                         LOGBOT V3                         ') + paint('cyan', '║'));
  console.log(paint('cyan', '╠════════════════════════════════════════════════════════════╣'));
  console.log(paint('cyan', '║') + '  ' + paint('green', '●') + '  Bot       : ' + botName);
  console.log(paint('cyan', '║') + '  ' + paint('blue', '◆') + '  Sunucular : ' + serverCount);
  console.log(paint('cyan', '║') + '  ' + paint('yellow', '◆') + '  Prefix    : .');
  console.log(paint('cyan', '║') + '  ' + paint('gray', '◆') + '  Yardım    : .help');
  console.log(paint('cyan', '╚════════════════════════════════════════════════════════════╝'));
}

function printSuccess(message) {
  console.log(paint('green', '✔') + ' ' + message);
}

function printInfo(message) {
  console.log(paint('blue', 'ℹ') + ' ' + message);
}

function printWarning(message) {
  console.warn(paint('yellow', '⚠') + ' ' + message);
}

function printError(label, error) {
  const detail = error?.message || error || 'Bilinmeyen hata';
  console.error(paint('red', '✖') + ' ' + label + ': ' + detail);
}

module.exports = { printBanner, printSuccess, printInfo, printWarning, printError };
