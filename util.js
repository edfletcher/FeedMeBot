'use strict';

const config = require('config');
const crypto = require('crypto');
const dfns = require('date-fns');

const PKGJSON = require('./package.json');
const VERSION = PKGJSON.version;
const NAME = PKGJSON.name;

async function floodProtect (delay, ops, ...args) {
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
      });
    });
  }
}

function fmtDuration (start) {
  if (typeof start === 'string') {
    start = dfns.parseISO(start);
  }

  const options = { format: ['years', 'months', 'weeks', 'days', 'hours', 'minutes'] };
  const fmt = () => dfns.formatDuration(dfns.intervalToDuration({ start, end: new Date() }), options);
  let dur = fmt();

  if (!dur) {
    options.format.push('seconds');
    dur = fmt();
  }

  if (dur.match(/days/)) {
    options.format.pop();
    dur = fmt();
  }

  return dur;
}

module.exports = {
  NAME,
  VERSION,

  floodProtect,
  fmtDuration,

  consistentId: (pubDate, isoDate, itemId) => crypto.createHash('sha256').update(Buffer.from(`${pubDate}/${isoDate}/${itemId}`)).digest('hex')
};
