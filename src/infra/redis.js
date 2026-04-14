const Redis = require("ioredis");
const config = require("../config");

const command = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: null
});

const subscriber = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: null
});

const publisher = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: null
});

module.exports = {
  command,
  subscriber,
  publisher
};
