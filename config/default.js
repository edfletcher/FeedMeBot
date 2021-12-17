'use strict';

module.exports = {
  default: {
    pollingFrequencyMinutes: 7,
    cacheDir: './.cache',
    logPath: './.logs'
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
      port: 6667,
      user: {
        nick: '',
        username: '',
        gecos: '',
        account: {
          account: '',
          password: ''
        }
      }
    }
  }
};
