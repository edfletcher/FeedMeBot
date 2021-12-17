'use strict';

const fs = require('fs');
const path = require('path');
const inq = require('inquirer');
const config = require('config');
const logger = require('./logger');
const irc = require('irc-framework');
const RssParser = require('rss-parser');
const { consistentId, floodProtect } = require('./util');

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

const serviceSpecificRenderers = {
  aws: (item) => {
    return `AWS event at ${item.pubDate}: "${item.title}" -- more info at ${item.guid}`;
  },

  azure: (item) => {
    return '';
  },

  gcp: (item) => {
    return `GCP event at ${new Date(item.pubDate).toLocaleString()}: "${item.title}" -- more info at ${item.link}`;
  }
};

async function connectIRCClient (connSpec) {
  if (connSpec.account && !connSpec.account.password && !connSpec.client_certificate) {
    const { password } = await inq.prompt({
      type: 'password',
      name: 'password',
      message: `Enter nickserv password for ${connSpec.nick}@${connSpec.host}`
    });

    connSpec.account.password = password;
  }

  if (connSpec.client_certificate && connSpec.client_certificate.fromFile) {
    const certFile = (await fs.promises.readFile(path.resolve(connSpec.client_certificate.fromFile))).toString('utf8');
    const boundaryRe = /-{5}(BEGIN|END)\s(PRIVATE\sKEY|CERTIFICATE)-{5}/g;
    const elems = {
      private_key: {},
      certificate: {}
    };

    for (const match of certFile.matchAll(boundaryRe)) {
      const [boundStr, state, type] = match;
      const typeXform = type.toLowerCase().replace(/\s+/g, '_');

      if (state === 'BEGIN') {
        if (type === 'PRIVATE KEY' && match.index !== 0) {
          throw new Error('pk start');
        }

        elems[typeXform].start = match.index;
      } else if (state === 'END') {
        if (elems[typeXform].start === undefined) {
          throw new Error('bad start!');
        }

        elems[typeXform] = certFile
          .substring(elems[typeXform].start, match.index + boundStr.length);
      }
    }

    if (Object.values(elems).some(x => !x)) {
      throw new Error('bad cert parse');
    }

    connSpec.client_certificate = elems;
  }

  const ircClient = new irc.Client();

  const regPromise = new Promise((resolve, reject) => {
    ircClient.on('registered', resolve.bind(null, ircClient));
  });

  ['message', 'debug', 'quit', 'reconnecting', 'close', 'socket close', 'kick', 'ban', 'join',
    'unknown command', 'channel info', 'topic', 'part', 'invited', 'tagmsg',
    'ctcp response', 'ctcp request', 'wallops', 'nick', 'nick in use', 'nick invalid',
    'whois', 'whowas', 'motd', 'info', 'help', 'mode']
    .forEach((ev) => {
      ircClient.on(ev, console.debug);
    });

  ircClient.connect(connSpec);
  return regPromise;
}

async function announce (sayFunc, svcName, item, fPath) {
  const rendered = serviceSpecificRenderers[svcName](item);
  console.log(`SAY'ing (svc: ${svcName}) "${rendered}"`);
  await sayFunc(rendered);
  return fs.promises.writeFile(fPath, JSON.stringify(item));
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

  const announceSayer = ircClient.say.bind(ircClient, config.irc.channel);
  await announceSayer('Hello, world!');

  for (const [svcName, feedUrl] of Object.entries(config.feeds.rss)) {
    const svcCheck = async () => {
      const parsed = await new RssParser().parseURL(feedUrl);
      const proced = serviceSpecificParsers[svcName](parsed);
      const nextCheck = Number(proced.next || config.default.pollingFrequencyMinutes);
      console.log(svcName, nextCheck, 'minutes', proced.items.length, 'items');

      await floodProtect(proced.items.map((item) => {
        return async () => {
          console.log('HERE!!');
          const fPath = path.resolve(path.join(config.default.cacheDir, svcName + '-' + item.outageBotId));
          try {
            await fs.promises.stat(fPath);
            // if stat doesn't throw then fPath exists so we've already announced it; skip!
            // TODO: better checking to ensure nothing has changed?
            console.log(`Skipping already cached ${fPath}`, item);
          } catch (err) {
            // file doesn't exist meaning we've not announced this item yet: do so!
            if (err.code === 'ENOENT') {
              return announce(announceSayer, svcName, item, fPath);
            }
          }
        };
      }));

      setTimeout(svcCheck, nextCheck * 1000 * 60);
    };

    svcCheck();
  }
}

if (require.main === module) {
  main();
}
