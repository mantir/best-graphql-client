const fetch = require("node-fetch");
const ws = require('ws');
const bestGraphqlClient = require('./bestGraphqlClient');

module.exports = bestGraphqlClient({fetch, ws});
