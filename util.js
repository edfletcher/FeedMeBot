'use strict';

const config = require('config');
const crypto = require('crypto');

const PKGJSON = require('./package.json');
const VERSION = PKGJSON.version;
const NAME = PKGJSON.name;

async function floodProtect (ops, ...args) {
  for (const op of ops) {
    await new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          resolve(await op(...args));
        } catch (e) {
          reject(e);
        }
      }, config.irc.floodProtectWaitMs);
    });
  }
}

module.exports = {
  NAME,
  VERSION,

  floodProtect,

  consistentId: (pubDate, isoDate, itemId) => crypto.createHash('sha256').update(Buffer.from(`${pubDate}/${isoDate}/${itemId}`)).digest('hex')
};
