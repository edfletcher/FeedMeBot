'use strict';

module.exports = {
  default: {
    pollingFrequencyMinutes: 7,
    cacheDir: './.cache',
    logPath: './.logs',
    floodProtectWaitMs: 5000
  },

  feeds: {
    rss: {
      azure: 'https://azurestatuscdn.azureedge.net/en-us/status/feed/',
      gcp: 'https://status.cloud.google.com/en/feed.atom',
      aws: 'https://status.aws.amazon.com/rss/all.rss'
    }
  },

  irc: {
    channel: '',
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
