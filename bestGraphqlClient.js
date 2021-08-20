var gql = require('graphql-tag');
if (typeof (gql) != 'function') gql = require('graphql-tag').default;
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

  var initLinkParams = { uri, credentials: options.credentials || 'same-origin' };
  if (polyfill) initLinkParams.fetch = polyfill.fetch;

  var client = new ApolloClient({ link: createUploadLink(initLinkParams), cache: new InMemoryCache({ addTypename: !!options.addTypename }), defaultOptions });
  var lib = {
    client,
    uri,
    requests: {},
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

    async getMulti(obj, opts) {
      return this.requestMulti('query', obj, opts);
    },

    async mutate(name, variables = {}, inc, fields, opts) {
      return this.submitQuery('mutation', name, variables, inc, fields, opts);
    },

    async mutateMulti(obj, opts) {
      return this.requestMulti('mutation', obj, opts);
    },

    async requestMulti(queryType, obj, { chunkSize, progressCallback } = {}) {
      if (isNaN(chunkSize) || chunkSize < 1) chunkSize = 100;
      var keys = Object.keys(obj);
      var allRes = {};
      for (var i = 0; i < keys.length; i += chunkSize) {
        var slice = keys.slice(i, i + chunkSize);
        if (!slice.length) break;
        var cObj = slice.reduce((newObj, o) => ({ ...newObj, [o]: obj[o] }), {});
        var query = this.buildMultiQuery(queryType, cObj);
        if (progressCallback) progressCallback((i + 1) / keys.length);
        var res = await this.submitQuery(queryType, query.query, query.variables, false, false, { multi: true });
        if (!res) res = { errors: ["Empty"] };
        if (res.errors) res = { ['errors_chunk_' + i]: res.errors, errors: res.errors }
        allRes = { ...allRes, ...res };
      }
      return allRes;
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
      var parenthesizedFields = '{' + fields + '}';
      if (fields === def[1]) {
        parenthesizedFields = '';
      }
      var fragments = inc ? this.buildFields(def[1], inc, '', true) : '';

      paramsDef += Object.keys(subParamsDef).map((varName) => {
        return ' $' + varName + ':' + subParamsDef[varName];
      }).join(', ');

      if (varIndex !== '') {
        if (params) { params = '(' + params + ')'; }
        return { query: `${name}${params} ${parenthesizedFields}`, paramsDef };
      }
      if (paramsDef) {
        params = '(' + params + ')';
        paramsDef = '(' + paramsDef + ')';
      }
      var query = `${queryType} do${paramsDef} { ${name}${params} ${parenthesizedFields} } ${fragments}`;
      return query;
    },


    buildMultiQuery(queryType, obj) {
      var query = '', paramsDef = '';
      var variables = {};
      Object.keys(obj).forEach((key, i) => {
        var d = obj[key];
        var q = this.buildQuery(queryType, d[0], d[1], d[2], d[3], i);
        if (!q) {
          console.log(packageName + ': MultiQuery ' + key + ' empty:', q, d);
        }
        if (d[1]) {
          Object.keys(d[1]).forEach((key) => {
            variables[key + i] = d[1][key];
          })
        }
        if (!isNaN(key)) key = 'a' + key;
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
                var val = included.split('|')[0];
                return val == a || val == '!' + a;
              }))
            });

            if (i == '*|fragment') uniqueAvailable = uniqueAvailable.map((a) => a + '|fragment');

            query += this.buildFields(name, uniqueAvailable, ' ', buildFragments, subParamsDef);
          } else if (typeof i == 'string') {
            if (i[0] == '!') continue;
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
      if (!opts) opts = {};
      if (this.headers) {
        opts.headers = { ...this.headers, ...opts.headers };
      }
      this.debug && console.log("\n--- " + packageName + " - Query ---\n", query, "\n", JSON.stringify(variables), this.debugHeaders ? opts.headers : '');
      try {
        var result = this.client[fun]({ [queryType]: gql(query), variables, context: opts }).catch((e) => {
          console.log(e, 'Query:', query);
          return e;
        });
      } catch (e) {
        console.log(e, 'Query:', query);
        var result = e;
      }

      if (opts.timeout) {
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
      var requestId = false;
      if (opts.requestId) {
        requestId = Math.random() + '';
        this.requests[opts.requestId] = requestId;
      }
      var res = await result;
      if (requestId) {
        if (this.requests[opts.requestId] != requestId) return { errors: "lapsed", requestId }
      }
      res = this.normalizeApiResult(res, name, opts);

      if (res && res.errors) {
        if (this.checkErrors && !opts.isRetry) {
          const shouldRetry = await this.checkErrors(res);
          if (shouldRetry) {
            return this.submitQuery(queryType, name, variables, inc, fields, { ...opts, isRetry: true });
          }
        }
        !this.debug && !query.match(/(login|password)/i) && console.log("\n--- " + packageName + " - Query ---\n", query, "\n", variables);
      }

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

  if (options.checkErrors) {
    lib.checkErrors = options.checkErrors;
    delete options.checkErrors;
  }

  if (options.initSubscriptions) {
    lib.initSubscriptions(options);
  }

  return lib;
};

module.exports = bestGraphqlClient;
