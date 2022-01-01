'use strict';

const fs = require('fs');
const path = require('path');
const inq = require('inquirer');
const config = require('config');
const logger = require('./logger');
const irc = require('irc-framework');
const RssParser = require('rss-parser');
const { consistentId, floodProtect, fmtDuration, VERSION, NAME } = require('./util');

const stats = {
  upSince: new Date(),
  announced: 0
};

const genericParser = (feedObj) => ({ items: feedObj.items.map(x => ({ outageBotId: consistentId(x.pubDate, x.isoDate, x.guid || x.id), ...x })) });

const serviceSpecificParsers = {
  aws: (feedObj) => {
    return {
      items: feedObj.items.map(x => ({ outageBotId: consistentId(x.pubDate, x.isoDate, x.guid), ...x })),
      next: feedObj.ttl
    };
  },

  gcp: (feedObj) => {
    return {
      items: feedObj.items.map(x => ({ outageBotId: consistentId(x.pubDate, x.isoDate, x.id), ...x }))
    };
  },

  oracle: (feedObj) => {
    return {
      items: feedObj.items.map(x => ({ outageBotId: consistentId(x.pubDate, x.isoDate, x.guid), ...x }))
    };
  }
};

const genericRenderer = (item, svcName) => `${svcName} event at ${new Date(item.pubDate || item.isoDate).toLocaleString()}: ` +
  `"${item.title}" -- ${item.link || item.guid}`;

const serviceSpecificRenderers = {
  aws: (item) => `AWS event at ${item.pubDate}: "${item.title}" -- ${item.guid}`,

  azure: (item) => `Azure event at ${item.pubDate}: "${item.title}" -- ${item.link}`,

  gcp: (item) => `GCP event at ${new Date(item.pubDate).toLocaleString()}: "${item.title}" -- ${item.link}`,

  oracle: (item) => `Oracle Cloud event at ${item.pubDate}: "${item.title}" -- ${item.guid}`
};

let notify;

// TODO: move all of this!
try {
  const notifyCache = path.resolve(config.feeds.notifications.cacheFile);
  fs.statSync(notifyCache);
  notify = Object.entries(JSON.parse(fs.readFileSync(notifyCache)))
    .reduce((a, [k, list]) => ({ [k]: new Set(list), ...a }), {});
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`Had trouble parsing the notification settings cache! ${err.message}`, err.stack);
  }

  notify = Object.keys(config.feeds.rss).reduce((a, k) => ({ [k.toLowerCase()]: new Set(), ...a }), {});
}

const privMsgOnlyCommands = ['help', 'notify'];

const commandHelpText = {
  uptime: {
    short: 'Displays my uptime and announcement count.'
  },

  feeds: {
    short: 'A list of all the feeds I\'m following.'
  },

  help: {
    short: 'This help! "help [command]" for more help with "command".'
  },

  notify: {
    short: 'Manage announcement notification settings.',
    usage: [
      'subCommand service',
      `where "service" may be "all", or one of: ${Object.keys(config.feeds.rss).map((x) => x.toLowerCase()).join(', ')}`
    ],
    subCommands: {
      add: 'Add yourself to the notification list for the given service.',
      delete: 'Remove yourself to the notification list for the given service.',
      list: 'Show the notification list for the given service.'
    }
  }
};

// Each handler function must return a list of strings, one for each line to be sent in reply
const commands = {
  uptime: async () => [`I've been online for ${fmtDuration(stats.upSince)} ` +
    `& have made ${stats.announced} announcements during that time.`],

  feeds: async () => [
    `I'm following these ${Object.entries(config.feeds.rss).length} RSS feeds:`,
    ...Object.entries(config.feeds.rss).map(([prov, feedUrl]) => `${feedUrl} (${prov})`)
  ],

  notify: async (msgObj, subCmd, service) => {
    service = service && service.toLowerCase();
    subCmd = subCmd && subCmd.toLowerCase();
    const svcNotifySet = notify[service];

    if (!svcNotifySet && service !== 'all') {
      return null;
    }

    let cmdFunc;
    if (['add', 'delete'].includes(subCmd)) {
      const innerFunc = (svcList) => svcList.forEach((svc) => notify[svc.toLowerCase()][subCmd](msgObj.nick));

      cmdFunc = async () => {
        innerFunc(service === 'all' ? Object.keys(config.feeds.rss) : [service]);
        return fs.promises.writeFile(path.resolve(config.feeds.notifications.cacheFile), JSON.stringify(
          Object.entries(notify).reduce((a, [k, set]) => ({ [k]: [...set], ...a }), {}), null, 2
        ));
      };
    } else if (subCmd === 'list') {
      cmdFunc = async () => service === 'all'
        ? Object.entries(notify).reduce((a, [sv, s]) => (a.concat([`${sv}: ${[...s].join(', ')}`])), [])
        : [[...svcNotifySet].join(', ')];
    }

    if (!cmdFunc) {
      return null;
    }

    try {
      const rv = await cmdFunc();
      return Array.isArray(rv) ? rv : [];
    } catch (err) {
      console.error(`notify subCommand ${subCmd} threw! ${err.message}`, err.stack, msgObj);
      return null;
    }
  },

  help: async (_msgObj, subCmd) => {
    if (!subCmd) {
      const padTo = Object.keys(commands).reduce((a, x) => Math.max(a, x.length), 0) + 1;
      return [`I am ${NAME} v${VERSION} and these are the commands that I understand:`,
        ...Object.keys(commands).sort().map((cmd) => `  ${cmd.padStart(padTo, ' ')} -- ${commandHelpText[cmd].short}`)];
    }

    const help = commandHelpText[subCmd];

    if (!help) {
      return [`Invalid subcommand "${subCmd}"`];
    }

    let retList = [help.short];

    if (help.usage) {
      retList = retList.concat([`Usage: ${subCmd} ${help.usage[0]}`, ...help.usage.slice(1).map(x => `  ${x}`)]);
    }

    if (help.subCommands) {
      const padTo = Object.keys(help.subCommands).reduce((a, x) => Math.max(a, x.length), 0) + 1;
      retList = retList.concat(['Subcommands:', ...Object.entries(help.subCommands)
        .map(([sc, txt]) => `  ${sc.padStart(padTo, ' ')} -- ${txt}`)]);
    }

    return retList;
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
    // todo: should have a timeout for reject...
  });

  ['debug', 'quit', 'reconnecting', 'close', 'socket close', 'kick', 'ban', 'join',
    'unknown command', 'channel info', 'topic', 'part', 'invited', 'tagmsg',
    'ctcp response', 'ctcp request', 'wallops', 'nick', 'nick in use', 'nick invalid',
    'whois', 'whowas', 'motd', 'info', 'help', 'mode']
    .forEach((ev) => {
      ircClient.on(ev, (x) => console.debug(`<IRC event "${ev}">`, x));
    });

  ircClient.connect(connSpec);
  return regPromise;
}

async function commandHandler (client, msgObj) {
  let privMsgReply = msgObj.target === config.irc.server.nick;
  let [trigger, command, ...args] = msgObj.message.trim().split(/\s+/g);

  if (!privMsgReply && trigger !== config.default.commandPrefix) {
    return;
  }

  // without trigger, have to swap everything down 1 position
  if (privMsgReply) {
    args = [command, ...args];
    command = trigger;
  }

  const handler = commands[command];

  if (!handler) {
    return;
  }

  const fpSay = async (lines) => {
    const numLines = lines.length;
    return floodProtect(config.default.commandFloodProtectWaitMs,
      lines.map((replyLine, i) => async () =>
        client.say(replyTarget, replyLine + (config.default.numberPrivMsgLines && privMsgReply ? ` (${i + 1}/${numLines})` : ''))));
  };

  let replyTarget = privMsgReply ? msgObj.nick : msgObj.target;
  const reply = await handler(msgObj, ...args);

  if (reply && reply.length) {
    if (!privMsgReply && privMsgOnlyCommands.includes(command)) {
      replyTarget = msgObj.nick;
      privMsgReply = true;
    }

    if (!privMsgReply) {
      reply[0] = `${msgObj.nick}: ${reply[0]}`;
    }

    console.log(`replying to ${command} with "${reply.join('|')}" on ${replyTarget}`);
    await fpSay(reply);
  } else if (reply) {
    console.log(`executed command ${command} but it produced no reply`);
    client.say(replyTarget, `Command "${command}" ran successfully.`);
  } else {
    await fpSay(await commands.help(msgObj, command));
  }

  console.debug(command, msgObj, args, reply);
}

function pinger (client, immediate) {
  const _pinger = () => {
    pinger.client.ping([pinger.prefix, Number(new Date()).toString()].join(pinger.tsDelim));
    delete pinger.stHandle;
    pinger(); // reschedule, but without `client` so as to _not_ reinitialize
  };

  if (!pinger.prefix && client) {
    pinger.prefix = [NAME, VERSION].join('-');
    pinger.tsDelim = '_';
    pinger.client = client;

    client.on('pong', (e) => {
      if (e.message && e.message.indexOf(pinger.prefix) === 0) {
        const [, pingTs] = e.message.split(pinger.tsDelim);
        console.log('Current latency is', new Date() - Number(pingTs), 'ms');
      }
    });

    if (immediate || process.env.DEBUG) {
      _pinger();
    }
  }

  if (!pinger.stHandle) {
    pinger.stHandle = setTimeout(_pinger, config.default.pingIntervalMinutes * 1000 * 60);
  }
}

async function main () {
  logger('main');

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

  console.log(`Connecting to ${config.irc.server.host}:${config.irc.server.port}...`);
  const connStart = new Date();
  const ircClient = await connectIRCClient(config.irc.server);

  if (config.irc.forceAuthAfterReg) {
    await ircClient.say('NickServ', 'login', config.irc.server.account.password);
  }

  ircClient.on('message', commandHandler.bind(null, ircClient));
  await ircClient.join(config.irc.channel);

  console.log(`Finished connecting in ${fmtDuration(connStart)}`);

  pinger(ircClient, true);

  process.on('SIGINT', async () => {
    await ircClient.part(config.irc.channel);
    clearTimeout(pinger.stHandle);
    setTimeout(() => process.exit(0), 1000);
  });

  const announceSayer = ircClient.say.bind(ircClient, config.irc.channel);

  for (const [svcName, feedUrl] of Object.entries(config.feeds.rss)) {
    const svcCheck = async (silentRunning = false) => {
      const procStart = new Date();
      const parsed = await new RssParser().parseURL(feedUrl);
      const processor = serviceSpecificParsers[svcName] ?? genericParser;
      const proced = processor(parsed);
      const nextCheck = Number(proced.next || config.default.pollingFrequencyMinutes);

      // we *do* want to await here, so that the time required to send all the messages
      // is accounted for in the next scheduled invocation (ensuring we never wrap back around on ourselves
      // still sending a bunch of messages from last invocation)
      await floodProtect(config.default.floodProtectWaitMs, proced.items.map((item) => {
        const svcNameLc = svcName.toLowerCase();
        const fPath = path.resolve(path.join(config.default.cacheDir, svcNameLc + '-' + item.outageBotId));
        try {
          fs.statSync(fPath);
          // if stat doesn't throw then fPath exists so we've already announced it; skip!
          // TODO: better checking to ensure nothing has changed?
          // TODO: should `touch` cache file to update mtime... once the items fall out of the RSS,
          // they won't get `touch`ed anymore and eventually we can use mtime to expire & remove them
          console.debug(`Skipping already cached ${fPath}`);
        } catch (err) {
          // file doesn't exist meaning we've not announced this item yet: do so!
          if (err.code === 'ENOENT') {
            fs.promises.writeFile(fPath, JSON.stringify(item));
            console.log(`Caching new item ${fPath}`);

            return async () => {
              if (!silentRunning) {
                const renderer = serviceSpecificRenderers[svcNameLc] ?? genericRenderer;
                let rendered = renderer(item, svcName);

                if (notify[svcNameLc].size) {
                  rendered += ` /cc: ${[...notify[svcNameLc]].join(', ')}`;
                }

                console.log(`SAY'ing (svc: ${svcName}) "${rendered}"`);
                ++stats.announced;
                return announceSayer(rendered);
              }
            };
          }
        }

        return () => {}; // make es-lint happy...
      }));

      console.log(svcName, 'processed', proced.items.length, 'items in', fmtDuration(procStart), '& will next check in', nextCheck, 'minutes');
      setTimeout(svcCheck, nextCheck * 1000 * 60);
    };

    svcCheck(config.default.silentFirstRun);
  }
}

if (require.main === module) {
  main();
}
