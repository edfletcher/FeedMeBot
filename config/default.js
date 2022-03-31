'use strict';

module.exports = {
  default: {
    pollingFrequencyMinutes: 7,
    cacheDir: './.cache',
    logPath: './.logs',
    floodProtectWaitMs: 1500,
    commandFloodProtectWaitMs: 250,
    commandPrefix: '@ob',
    allowedCommanders: [],
    silentFirstRun: true,
    numberPrivMsgLines: false,
    pingIntervalMinutes: 3
  },

  feeds: {
    rss: {
      Azure: 'https://azurestatuscdn.azureedge.net/en-us/status/feed/',
      GCP: 'https://status.cloud.google.com/en/feed.atom',
      AWS: 'https://status.aws.amazon.com/rss/all.rss',
      Oracle: 'https://ocistatus.oraclecloud.com/history.rss',
      Github: 'https://www.githubstatus.com/history.rss',
      Twitter: 'https://api.twitterstat.us/history.rss'
    },
    notifications: {
      cacheFile: './.notification.settings'
    }
  },

  irc: {
    channel: '',
    forceAuthAfterReg: false,
    server: {
      host: '',
      port: 6697,
      tls: true,
      sasl_mechanism: 'EXTERNAL',
      enable_echomessage: true,
      nick: '',
      username: '',
      gecos: '',
      account: {
        account: '',
        password: ''
      },
      client_certificate: {
        fromFile: ''
      }
    }
  }
};
