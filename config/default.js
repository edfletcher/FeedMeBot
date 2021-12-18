'use strict';

module.exports = {
  default: {
    pollingFrequencyMinutes: 7,
    cacheDir: './.cache',
    logPath: './.logs',
    floodProtectWaitMs: 2500,
    commandFloodProtectWaitMs: 500,
    commandPrefix: '@ob'
  },

  feeds: {
    rss: {
      azure: 'https://azurestatuscdn.azureedge.net/en-us/status/feed/',
      gcp: 'https://status.cloud.google.com/en/feed.atom',
      aws: 'https://status.aws.amazon.com/rss/all.rss',
      oracle: 'https://ocistatus.oraclecloud.com/history.rss'
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
