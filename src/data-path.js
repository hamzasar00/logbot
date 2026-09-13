const fs = require('fs');
const path = require('path');
const os = require('os');

const dataRoot = process.env.SESODASI_DATA_DIR
  ? path.resolve(process.env.SESODASI_DATA_DIR)
  : path.join(process.env.APPDATA || process.env.HOME || os.homedir(), 'ses-odasi-data');

fs.mkdirSync(dataRoot, { recursive: true });

function getDataFile(fileName) {
  const target = path.join(dataRoot, fileName);
  const legacy = path.join(__dirname, '..', 'data', fileName);
  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    try {
      fs.copyFileSync(legacy, target);
    } catch (error) {
      console.error('Kalıcı ayar dosyası taşınamadı:', error.message);
    }
  }
  return target;
}

module.exports = { getDataFile, dataRoot };
