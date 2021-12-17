'use strict';

const config = require('config');
const crypto = require('crypto');

const PKGJSON = require('./package.json');
const VERSION = PKGJSON.version;
const NAME = PKGJSON.name;

async function floodProtect (ops, ...args) {
  if (!config.default.floodProtectWaitMs) {
    throw new Error('config.default.floodProtectWaitMs not defined!');
  }

  for (const op of ops) {
    await new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          resolve(await (typeof op === 'function' ? op(...args) : op));
        } catch (e) {
          reject(e);
        }
      }, config.default.floodProtectWaitMs);
    });
  }
}

module.exports = {
  NAME,
  VERSION,

  floodProtect,

  consistentId: (pubDate, isoDate, itemId) => crypto.createHash('sha256').update(Buffer.from(`${pubDate}/${isoDate}/${itemId}`)).digest('hex')
};
