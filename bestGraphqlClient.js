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

const defaultOptions = {
  watchQuery: {
    fetchPolicy: 'no-cache',
    errorPolicy: 'ignore',
  },
  query: {
    fetchPolicy: 'no-cache',
    errorPolicy: 'all',
  }
};

var bestGraphqlClient = (polyfill = false) => (uri, definitions, options = false) => {
  if (!definitions) {
    definitions = { query: {}, mutation: {}, subscription: {}, entities: {} };
  }
  if (!options) {
    options = {};
  }
  options = { initSubscriptions: false, addTypename: false, ...options };

  var initLinkParams = { uri };
  if (polyfill) initLinkParams.fetch = polyfill.fetch;

  var client = new ApolloClient({ link: createUploadLink(initLinkParams), cache: new InMemoryCache({ addTypename: !!options.addTypename }), defaultOptions });
  var lib = {
    client,
    initSubscriptions(opts) {
      var host = opts && opts.host || uri;
      const wsUri = host.replace(/^http/i, 'ws');
      const subscriptionClient = new SubscriptionClient(wsUri, { reconnect: true, ...opts }, polyfill && polyfill.ws);
      const wsLink = new WebSocketLink(subscriptionClient);
      wsLink.subscriptionClient.on("connected", () => {
        console.log("connected " + packageName + " to " + wsUri + ' (' + (new Date()).toLocaleTimeString() + ')');
      });
      var disconnectedTimer = 0;
      var disconnectedCount = 0;
      wsLink.subscriptionClient.on("disconnected", () => {
        /* if(disconnectedTimer) {
          disconnectedCount++;
        } else {
          disconnectedCount = 1;
          disconnectedTimer = setTimeout(() => {
            disconnectedTimer = false;
            console.log("disconnected " + packageName + " from " + wsUri + ' x ' + disconnectedCount + ' (' + (new Date()).toLocaleTimeString() + ')');
            disconnectedCount = 0;
          }, 15000);
        } */
      });

      const httpLink = createUploadLink(initLinkParams);
      const link = split(
        ({ query }) => {
          const { kind, operation } = getMainDefinition(query);
          return kind === 'OperationDefinition' && operation === 'subscription';
        }, wsLink, httpLink,
      );
      this.client = new ApolloClient({ link, cache: new InMemoryCache(), defaultOptions });
      this.subscriptionClient = wsLink.subscriptionClient;
    },
    subscriptions: {},

    fragment(name, inc, fields) {
      return this.buildFields(name, inc, fields, 1);
    },

    async get(name, variables = {}, inc, fields, opts) {
      return this.submitQuery('query', name, variables, inc, fields, opts);
    },

    async getMulti(obj) {
      var query = this.buildMultiQuery('query', obj);
      return this.submitQuery('query', query.query, query.variables, false, false, { multi: true });
    },

    async mutate(name, variables = {}, inc, fields, opts) {
      return this.submitQuery('mutation', name, variables, inc, fields, opts);
    },

    async mutateMulti(obj) {
      var query = this.buildMultiQuery('mutation', obj);
      return this.submitQuery('mutation', query.query, query.variables, false, false, { multi: true });
    },

    async subscribe(callback, name, variables = {}, inc, fields, opts) {
      if (!this.subscriptionClient) {
        this.initSubscriptions(opts);
      }
      if (typeof inc == 'string') {
        opts = fields;
        fields = inc;
        inc = false;
      }
      var queryString = this.buildQuery('subscription', name, variables, inc, fields);
      console.log(queryString);

      //this.subscriptions[queryString] = true;
      var subResult = await this.client.subscribe({ query: gql(queryString), variables }).subscribe({
        next: (data) => {
          callback(this.normalizeApiResult(data, name));
        },
        error(error) {
          console.log('Subscription-error', error, uri);
          callback({ error });
        }
      });
      //subResult.queryString = queryString;
      return subResult;
    },

    buildQuery(queryType, name, variables = {}, inc, fields = '', varIndex = '') {
      var def = definitions[queryType][name];
      if (!def) {
        return name;
      }
      var varKeys = Object.keys(variables).filter((k) => typeof (variables[k]) !== 'undefined');
      var paramsDef = varKeys.map((k) => '$' + k + varIndex + ':' + def[0][k]).join(', ');
      var params = varKeys.map((k) => k + ':$' + k + varIndex).join(', ');

      var subParamsDef = {};
      fields = this.buildFields(def[1], inc, fields, false, subParamsDef);
      var fragments = inc ? this.buildFields(def[1], inc, '', true) : '';

      paramsDef += Object.keys(subParamsDef).map((varName) => {
        return ' $' + varName + ':' + subParamsDef[varName];
      }).join(', ');

      if (varIndex !== '') {
        if (params) { params = '(' + params + ')'; }
        return { query: `${name}${params} { ${fields} }`, paramsDef };
      }
      if (paramsDef) {
        params = '(' + params + ')';
        paramsDef = '(' + paramsDef + ')';
      }
      var query = `${queryType} do${paramsDef} { ${name}${params} { ${fields} } } ${fragments}`;
      return query;
    },


    buildMultiQuery(queryType, obj) {
      var query = '', paramsDef = '';
      var variables = {};
      Object.keys(obj).forEach((key, i) => {
        var d = obj[key];
        var q = this.buildQuery(queryType, d[0], d[1], d[2], d[3], i);
        if (d[1]) {
          Object.keys(d[1]).forEach((key) => {
            variables[key + i] = d[1][key];
          })
        }
        paramsDef += ' ' + q.paramsDef;
        query += ' ' + key + ': ' + q.query;
      })
      if (paramsDef) {
        paramsDef = '(' + paramsDef + ')';
      }
      query = `${queryType} do ${paramsDef} { ${query} }`;
      return { query, variables };
    },

    buildFields(name, inc, fields = false, buildFragments = false, subParamsDef = {}) {
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
        if (!Array.isArray(inc)) {
          if (typeof inc == 'object') {
            inc = [inc];
          } else {
            //throw packageName + ": includes must be an array or objects, but got " + inc + '. Make sure that all includes are either objects or inside of arrays.';
            return '';
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

            query += this.buildFields(name, uniqueAvailable, ' ', buildFragments, subParamsDef);
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
              var params = '';
              if (!available[keyName]) throw packageName + ": " + keyName + " is no available include for " + name;

              var subType = available[keyName].type;
              var subArgs = available[keyName].args;
              /* Variablen für Parameter von Includes */
              if (i[key]['$']) {
                for (var subVar in i[key]['$']) {
                  var varName = subVar + Object.keys(subParamsDef).length;
                  subParamsDef[varName] = subArgs[subVar];
                  params += subVar + ': $' + varName;
                }
                if (params) params = '(' + params + ')';
                delete i[key]['$'];
              }
              /* Anderer Name für ein Include */
              if (i[key]['$name']) {
                keyName = i[key]['$name'] + ': ' + keyName;
                delete i[key]['$name'];
              }
              fields = this.buildFields(subType, i[key], fields, buildFragments && !asFragment ? true : false, subParamsDef);
              if (asFragment && !buildFragments && fields) {
                fields = '...' + subType;
              }
              if (fields) {
                var parenthesizedFields = '{' + fields + '}';
                if (asFragment && buildFragments) {
                  var frag = `fragment ${subType} on ${definitions.entities[subType].entity} ${parenthesizedFields}`;
                  if (!fragMap[subType]) {
                    query += frag;
                  }
                  fragMap[subType] = true;
                } else if (!buildFragments) {
                  if (!definitions.entities[subType]) {
                    parenthesizedFields = '';
                  }
                  query += ' ' + keyName + params + parenthesizedFields;
                } else if (buildFragments && fields.match(/fragment.*? on /)) {
                  query += fields;
                }
              }
            }
          }
        }
      }
      return query;
    },

    normalizeApiResult(res, name = '', opts) {
      //console.log('normalize', res);

      if (typeof name == 'undefined') name = '';
      if (res.errors) {
        return res;
      } else
        if (res.data) {
          if (opts && opts.multi) {
            res = res.data;
          } else
            if (res.data[name]) {
              res = res.data[name];
            } else {
              var keys = typeof (res.data) == 'object' ? Object.keys(res.data) : [];
              res = keys.length == 1 ? res.data[keys[0]] : res.data;
            }
        } else {
          if (typeof (res) != 'object') {
            res = { errors: [{ message: res }] };
          } else {
            if (res.graphQLErrors && res.graphQLErrors.length) {
              res.errors = res.graphQLErrors;
            } else if (res.networkError) {
              res.errors = res.networkError.result ? res.networkError.result.errors : [res.networkError];
            } else if (!res || !res.errors) {
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

    async submitQuery(queryType, name, variables = {}, inc, fields, opts) {
      if (typeof inc == 'string') {
        opts = fields;
        fields = inc;
        inc = false;
      }
      var query = this.buildQuery(queryType, name, variables, inc, fields);

      const fun = queryType != 'query' ? 'mutate' : 'query';
      this.debug && console.log("\n--- " + packageName + " - Query ---\n", query, "\n", JSON.stringify(variables));
      if(this.headers) {
        if(!opts) opts = {};
        opts.headers = {...this.headers, ...opts.headers};
      }
      var result = this.client[fun]({ [queryType]: gql(query), variables, context: opts }).catch((e) => {
        return e;
      });

      if (opts && opts.timeout) {
        const timer = new Promise((resolve) => {
          setTimeout(resolve, opts.timeout, {
            errors: [{ message: 'Timeout during request to: ' + (uri) + ' after ' + opts.timeout + ' seconds.' }],
          });
        });
        result = Promise.race([
          result,
          timer
        ]);
      }
      var res = await result;
      if (res && res.errors) {
        !this.debug && console.log("\n--- " + packageName + " - Query ---\n", query, "\n", variables);
      }
      res = this.normalizeApiResult(res, name, opts);

      return res;
    },

    fetch(url, opts) {
      if (polyfill && polyfill.fetch) {
        const fetch = polyfill.fetch;
      }
      return fetch(url, opts);
    },

    setHeaders(headers) {
      this.headers = headers;
    }
  }


  for (var i in lib) {
    if (typeof lib[i] == 'function') {
      lib[i] = lib[i].bind(lib);
    }
  }

  if (options.headers) {
    lib.headers = options.headers;
    delete options.headers;
  }

  if (options.initSubscriptions) {
    lib.initSubscriptions(options);
  }

  return lib;
};

module.exports = bestGraphqlClient;
