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
  if(!definitions) {
    definitions = { query : {}, mutation: {}, subscription: {}, entities: {} };
  }
  var initLinkParams = { uri };
  if(polyfill) initLinkParams.fetch = polyfill.fetch;
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

    fields(what, inc, query, fragment) {
      if (query == 'fragment') {
        fragment = true;
        query = '';
      }
      if (!definitions.entities[what]) {
        if (query) return query;
        return what;
      }
      if (!query) {
        query = definitions.entities[what].fields;
      }
      query = this.buildFields(query, inc, definitions.entities[what].availableInc);
      if (fragment) {
        query = `fragment ${what} on ${definitions.entities[what].entity} { ${query} }`;
      }
      return query;
    },

    fragment(name, inc, fields) {
      return this.fields(name, inc, fields, 1);
    },

    buildFields(query, inc, available) {
      if (inc) {
        if (inc === '*') inc = Object.keys(available);
        for (var i of inc) {
          if (i == '*') {
            var uniqueAvailable = Object.keys(available).reduce((obj, a) => {
              if (inc.find((included) => {
                if (typeof (included) == 'object') {
                  return Object.keys(included).find((ikey) => ikey == a);
                }
                return included == a;
              })) return obj;
              obj[a] = available[a];
              return obj;
            }, {});
            query += this.buildFields('', '*', uniqueAvailable);
          } else if (typeof i == 'string' && available[i]) {
            var fields = this.fields(available[i]);
            if (fields) {
              query += ' ' + i + '{' + fields + '}';
            }
          } else if (typeof i == 'object') {
            for (var key of Object.keys(i)) {
              var fields = this.fields(available[key], i[key]);
              if (fields) {
                query += ' ' + key + '{' + fields + '}';
              }
            }
          }
        }
      }
      return query;
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

    buildQuery(queryType, name, variables = {}, inc, fields) {
      if (typeof inc == 'string' && inc != '*') {
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
      fields = this.fields(def[1], inc, fields);
      if (paramsDef) {
        params = '(' + params + ')';
        paramsDef = '(' + paramsDef + ')';
      }
      var query = `${queryType} do${paramsDef} { ${name}${params} { ${fields} } }`;
      return query;
    },

    async submitQuery(queryType, name, variables = {}, inc, fields) {
      var query = this.buildQuery(queryType, name, variables, inc, fields);

      const fun = queryType != 'query' ? 'mutate' : 'query';
      this.debug && console.log("\n--- " + packageName + " - Query ---\n", query, variables);
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
