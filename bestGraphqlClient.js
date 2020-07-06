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


var bestGraphqlClient = (polyfill = false) => (uri, definitions, options = false) => {
  if (!definitions) {
    definitions = { query: {}, mutation: {}, subscription: {}, entities: {} };
  }
  if(!options) {
    options = { initSubscriptions: false };
  }
  var initLinkParams = { uri };
  if (polyfill) initLinkParams.fetch = polyfill.fetch;

  var client = new ApolloClient({ link: createUploadLink(initLinkParams), cache: new InMemoryCache() });
  var lib = {
    client,
    initSubscriptions(opts) {
      const wsUri = uri.replace(/^http/i, 'ws') + '/graphql';
      const subscriptionClient = new SubscriptionClient(wsUri, { reconnect: true, ...opts }, polyfill && polyfill.ws);
      const wsLink = new WebSocketLink(subscriptionClient);
      wsLink.subscriptionClient.on("connected", () => {
        console.log("connected " + packageName + " to " + wsUri + ' (' + (new Date()).toLocaleTimeString() + ')');
      });
      wsLink.subscriptionClient.on("disconnected", () => {
        console.log("disconnected " + packageName + " from " + wsUri + ' (' + (new Date()).toLocaleTimeString() + ')');
      });

      const httpLink = createUploadLink(initLinkParams);
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

    async get(name, variables = {}, inc, fields, opts) {
      return this.submitQuery('query', name, variables, inc, fields, opts);
    },

    async mutate(name, variables = {}, inc, fields, opts) {
      return this.submitQuery('mutation', name, variables, inc, fields, opts);
    },

    async subscribe(callback, name, variables = {}, inc, fields, opts) {
      if (!this.subscriptionClient) {
        this.initSubscriptions(opts);
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
      var def = definitions[queryType][name];
      if (!def) {
        return name;
      }
      var varKeys = Object.keys(variables);
      var paramsDef = varKeys.map((k) => '$' + k + ':' + def[0][k]).join(', ');
      var params = varKeys.map((k) => k + ':$' + k).join(', ');

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

    buildFields(name, inc, fields = false, buildFragments = false) {
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
        if(!Array.isArray(inc)) {
          if(typeof inc == 'object') {
            inc = [inc];
          } else {
            throw packageName + ": includes must be an array or objects, but got " + inc+ '. Make sure that all includes are either objects or inside of arrays.';
          }
        }
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
            
            query += this.buildFields(name, uniqueAvailable, ' ', buildFragments);
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
              fields += this.buildFields(available[keyName], i[key], '', buildFragments && !asFragment ? true : false);
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
                } else if(buildFragments) {
                  query += fields;
                }
              }
            }
          }
        }
      }
      return query;
    },

    async submitQuery(queryType, name, variables = {}, inc, fields, opts) {
      if (typeof inc == 'string') {
        opts = fields;
        fields = inc;
        inc = false;
      }
      var query = this.buildQuery(queryType, name, variables, inc, fields);

      const fun = queryType != 'query' ? 'mutate' : 'query';
      this.debug && console.log("\n--- " + packageName + " - Query ---\n", query, "\n", variables);
      var result = this.client[fun]({ [queryType]: gql(query), variables, context: opts }).catch((e) => e);

      if (opts.timeout) {
        const timer = new Promise((resolve) => {
          setTimeout(resolve, opts.timeout, {
            errors: [{ message: 'Timeout during request to: ' + (uri) }],
          });
        });
        result = Promise.race([
          result,
          timer
        ]);
      }

      var res = await result;
      
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
          } else if(!res || !res.errors) {
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

  if(options.initSubscriptions) {
    lib.initSubscriptions(options);
  }

  return lib;
};

module.exports = bestGraphqlClient;
