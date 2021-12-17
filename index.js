'use strict';

const fs = require('fs');
const path = require('path');
const inq = require('inquirer');
const config = require('config');
const logger = require('./logger');
const irc = require('irc-framework');
const RssParser = require('rss-parser');
const { consistentId } = require('./util');

const serviceSpecificParsers = {
  aws: (feedObj) => {
    return {
      items: feedObj.items.map(x => ({ outageBotId: consistentId(x.pubDate, x.isoDate, x.guid), ...x })),
      next: feedObj.ttl
    };
  },

  azure: (feedObj) => {
    return {
      items: feedObj.items
    };
  },

  gcp: (feedObj) => {
    return {
      items: feedObj.items.map(x => ({ outageBotId: consistentId(x.pubDate, x.isoDate, x.id), ...x }))
    };
  }
};

async function announce (client, item) {

}

async function connectIRCClient (connSpec) {
  if (connSpec.account && !connSpec.account.password) {
    const { password } = await inq.prompt({
      type: 'password',
      name: 'password',
      message: `Enter nickserv password for ${connSpec.nick}@${connSpec.host}`
    });

    connSpec.account.password = password;
  }

  const ircClient = new irc.Client();

  const regPromise = new Promise((resolve, reject) => {
    ircClient.on('registered', resolve.bind(null, ircClient));
  });

  ircClient.on('debug', console.debug);
  ircClient.on('message', console.debug);
  ircClient.connect(connSpec);
  return regPromise;
}

async function main () {
  logger('outage-bot');

  if (process.env.DEBUG) {
    logger.enableLevel('debug');
  }

  try {
    fs.mkdirSync(path.resolve(config.default.cacheDir));
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  const ircClient = await connectIRCClient(config.irc.server);
  await ircClient.join(config.irc.channel);

  for (const [svcName, feedUrl] of Object.entries(config.feeds.rss)) {
    const svcCheck = async () => {
      const parsed = await new RssParser().parseURL(feedUrl);
      const proced = serviceSpecificParsers[svcName](parsed);
      const nextCheck = Number(proced.next || config.default.pollingFrequencyMinutes);
      console.log(svcName, nextCheck, 'minutes', proced.items.length, 'items');

      for (const item of proced.items) {
        const fPath = path.join(config.default.cacheDir, svcName + '-' + item.outageBotId);
        try {
          const fStat = await fs.promises.stat(fPath);
          console.log(fPath, fStat);
        } catch (err) {
          // file doesn't exist meaning we've not announced this item yet: do so!
          if (err.code === 'ENOENT') {
            announce();
          }
        }
      }

      setTimeout(svcCheck, nextCheck * 1000 * 60);
    };

    svcCheck();
  }
}

main();
