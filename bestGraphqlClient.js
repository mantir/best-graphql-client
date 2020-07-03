const gql = require('graphql-tag');
const { ApolloClient } = require('apollo-client');
const { split } = require('apollo-link');
const { createUploadLink } = require('apollo-upload-client');
const { WebSocketLink } = require('apollo-link-ws');
const { getMainDefinition } = require('apollo-utilities');
const { InMemoryCache } = require('apollo-cache-inmemory');
const { SubscriptionClient } = require("subscriptions-transport-ws");
const HttpLink = createUploadLink;

const packageName = 'best-graphql-client';


var bestGraphqlClient = (polyfill = false) => (uri, definitions) => {
  if (!definitions) {
    definitions = { query: {}, mutation: {}, subscription: {}, entities: {} };
  }
  var initLinkParams = { uri };
  if (polyfill) initLinkParams.fetch = polyfill.fetch;
  var client = new ApolloClient({ link: new HttpLink(initLinkParams), cache: new InMemoryCache() });
  var lib = {
    client,
    initSubscriptions() {
      const wsUri = uri.replace(/^http/i, 'ws') + '/graphql';
      const subscriptionClient = new SubscriptionClient(wsUri, { reconnect: true }, polyfill && polyfill.ws);
      const wsLink = new WebSocketLink(subscriptionClient);
      wsLink.subscriptionClient.on("connected", () => {
        console.log("connected " + packageName + " to " + wsUri + ' (' + (new Date()).toLocaleTimeString() + ')');
      });
      wsLink.subscriptionClient.on("disconnected", () => {
        console.log("disconnected " + packageName + " from " + wsUri + ' (' + (new Date()).toLocaleTimeString() + ')');
      });

      const httpLink = new HttpLink(initLinkParams);
      const link = split(
        ({ query }) => {
          const { kind, operation } = getMainDefinition(query);
          return kind === 'OperationDefinition' && operation === 'subscription';
        }, wsLink, httpLink,
      );
      this.client = new ApolloClient({ link, cache: new InMemoryCache() });
      this.subscriptionClient = wsLink.subscriptionClient;
    },
    subscriptions: {},

    fragment(name, inc, fields) {
      return this.buildFields(name, inc, fields, 1);
    },

    setCoreUrl(uri) {
      this.client = new ApolloClient({ link: new HttpLink(initLinkParams), cache: new InMemoryCache() });
      console.log("\n--- Set Client coreUrl ---\n", uri);
      return 'success';
    },

    async get(name, variables = {}, inc, fields) {
      return this.submitQuery('query', name, variables, inc, fields);
    },

    async mutate(name, variables = {}, inc, fields) {
      return this.submitQuery('mutation', name, variables, inc, fields);
    },

    async subscribe(callback, name, variables = {}, inc, fields) {
      if (!this.subscriptionClient) {
        this.initSubscriptions();
      }
      var queryString = this.buildQuery('subscription', name, variables, inc, fields);
      console.log(queryString);

      this.subscriptions[queryString] = true;
      var subResult = await this.client.subscribe({ query: gql(queryString), variables }).subscribe({
        next(data) {
          callback(data);
        },
        error(error) {
          console.log('Subscription-error', error, uri);
        }
      });
      return subResult;
    },

    buildQuery(queryType, name, variables = {}, inc, fields = '') {
      if (typeof inc == 'string') {
        fields = inc;
        inc = false;
      }
      var def = definitions[queryType][name];
      if (!def) {
        return name;
      }
      var varKeys = Object.keys(variables);
      var paramsDef = varKeys.map((k) => '$' + k + ':' + def[0][k]).join(', ');
      var params = varKeys.map((k) => k + ':$' + k).join(', ');

      var fragments = false;
      if (!Array.isArray(inc) && typeof inc == 'object') {
        if (inc.fragments) {
          fragments = inc.fragments;
        }
        inc = inc.inc;
      }

      fields = this.buildFields(def[1], inc, fields);

      if (paramsDef) {
        params = '(' + params + ')';
        paramsDef = '(' + paramsDef + ')';
      }

      var query = `${queryType} do${paramsDef} { ${name}${params} { ${fields} } }`;
      if (inc) {
        query += ' ' + this.buildFields(def[1], inc, '', 2);
      }
      return query;
    },

    buildFields(name, inc, fields = false, fragment = 0) {
      var buildFragments = fragment === 2;
      var isFragment = fragment === 1;
      if (!definitions.entities[name]) {
        return name;
      }
      var query = '';

      if (fields) {
        query = fields;
      } else if (!buildFragments) {
        query = definitions.entities[name].fields;
      }

      var fragMap = {};

      if (inc) {
        if(!Array.isArray(inc)) throw packageName + ": includes must be an array, but got " + inc+ '. Make sure that all includes are inside of arrays.';
        var available = definitions.entities[name].availableInc;
        for (var i of inc) {
          if (i == '*' || i == '*|fragment') {
            var uniqueAvailable = Object.keys(available).filter((a) => {
              return !(inc.find((included) => {
                if (typeof (included) == 'object') {
                  return Object.keys(included).find((ikey) => ikey.split('|')[0] == a);
                }
                return included.split('|')[0] == a;
              }))
            });
            
            if (i == '*|fragment') uniqueAvailable = uniqueAvailable.map((a) => a + '|fragment');
            
            query += this.buildFields(name, uniqueAvailable, ' ', fragment);
          } else if (typeof i == 'string') {
            i = { [i]: false };
          }
          if (typeof i == 'object') {
            for (var key of Object.keys(i)) {
              var keyParts = key.split('|');
              var keyName = keyParts[0];
              var asFragment = keyParts[1] == 'fragment';
              var fragIndex = asFragment ? 2 : 1;
              var fields = keyParts[fragIndex] ? keyParts[fragIndex] + ' ' : '';
              fields += this.buildFields(available[keyName], i[key], '', buildFragments && asFragment ? 1 : 0);
              if (asFragment && !buildFragments && fields) {
                fields = '...' + available[keyName];
              }
              if (fields) {
                if (asFragment && buildFragments) {
                  var frag = `fragment ${available[keyName]} on ${definitions.entities[available[keyName]].entity} { ${fields} }`;
                  if (!fragMap[frag])
                    query += frag;
                  fragMap[frag] = true;
                } else if (!buildFragments) {
                  query += ' ' + keyName + '{' + fields + '}';
                }
              }
            }
          }
        }
      }
      return query;
    },

    async submitQuery(queryType, name, variables = {}, inc, fields) {
      var query = this.buildQuery(queryType, name, variables, inc, fields);

      const fun = queryType != 'query' ? 'mutate' : 'query';
      this.debug && console.log("\n--- " + packageName + " - Query ---\n", query, "\n", variables);
      var res = await this.client[fun]({ [queryType]: gql(query), variables }).catch((e) => e);

      if (res.data && res.data[name]) {
        res = res.data[name];
      } else {
        if (typeof (res) != 'object') {
          res = { errors: [{ message: res }] };
        } else {
          if (res.graphQLErrors && res.graphQLErrors.length) {
            res.errors = res.graphQLErrors;
          } else if (res.networkError) {
            res.errors = res.networkError.result ? res.networkError.result.errors : [res.networkError];
          } else {
            res = {
              ...res, errors: [{
                message: 'Unknown error during request in ' + packageName + '. Endpoint: ' + uri
              }]
            }
          }
        }
      }
      return res;
    },
  }


  for (var i in lib) {
    if (typeof lib[i] == 'function') {
      lib[i] = lib[i].bind(lib);
    }
  }

  return lib;
};

module.exports = bestGraphqlClient;
