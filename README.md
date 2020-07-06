# Best Javascript GraphQL Client for the Browser and Node.js

Just provide the url of any GraphQL endpoint to generate the information the client needs and be ready to write queries like this:

```javascript
bgc.get('posts', {where: {title: "Your title"}}, ["author", {comments: ["user"]}])
```

If you care about overfetching and don't need all the fields, just use GraphQL-syntax as you already now it:

```javascript
bgc.get('posts', {where: {title: "Your title"}}, 'text author{ name } comments{ text user{ id name } }');
```

Or put in a whole GraphQL-query. It's up to you:

```javascript
bgc.get('query { posts { text author{ name } comments{ text user{ id name } } } }');
```

By the way: The client supports subscriptions out of the box:

```javascript
bgc.subscribe(function(data) { console.log(data); }, 'notification', {where: {user: {id: 1}}});
```

This client is the best for you, if you like it short and elegant. It uses the ApolloClient in the background. 

## Installation

### Add this repo to your package.json:

_*dependencies:*_

- "best-graphql-client": "git+https://github.com/mantir/best-graphl-client.git"

### Add this script to your package.json: 

_*scripts:*_

- "generate": "FOLDER=\`pwd\` npm run --prefix node_modules/best-graphql-client generate"

```bash
npm install
```

### Generate definitions for endpoint:
```bash
ENDPOINT=https://url-to-endpoint npm run generate
ENDPOINT=https://url-to-endpoint NAME=definitions-filename npm run generate
```
This will create definitions.js which must be included when initializing the client.

```javascript
const endpoint = 'http://url-to-endpoint'; //Url to endpoint
const definitions = require('./definitions');
var bgc = require('best-graphql-client/browser')(endpoint, definitions);
/* OR */
var bgc = require('best-graphql-client/nodejs')(endpoint, definitions);
```

## Functions

The following functions can be used to query a GraphlQL endpoint. 

### get(_string_ name [, _object_ parameters [, _array_ includes] [, _string_ fields] [, _object_ options]])
_Graphql-Query_: 
`query do(parameters) { name(parameters) { fields + includes } }`

If 3 parameters are given: If the 3rd is a string, it is used as the `fields`.
If `fields` are empty, all fields are returned.
`includes` can also be ['*'], then all connected objects are returned. (See Example-Usage)

### mutate(_string_ name [, _object_ parameters [, _array_ includes] [, _string_ fields] [, _object_ options]])
_Graphql-Mutation_: (Same as `get`, just as `mutation`)


### subscribe(_function_ callback, _string_ name [, _object_ parameters [, _array_ includes] [, _string_ fields] [, _object_ options]])
_Graphql-Mutation_: (Same as `get`, just as `subscription`)
- `options?: Object` : optional, object to modify default ApolloClient behavior
  * `timeout?: number` : how long the client should wait in ms for a keep-alive message from the server (default 30000 ms), this parameter is ignored if the server does not send keep-alive messages. This will also be used to calculate the max connection time per connect/reconnect
  * `lazy?: boolean` : use to set lazy mode - connects only when first subscription created, and delay the socket initialization
  * `connectionParams?: Object | Function | Promise<Object>` : object that will be available as first argument of `onConnect` (in server side), if passed a function - it will call it and send the return value, if function returns as promise - it will wait until it resolves and send the resolved value.
  * `reconnect?: boolean` : automatic reconnect in case of connection error
  * `reconnectionAttempts?: number` : how much reconnect attempts
  * `connectionCallback?: (error) => {}` : optional, callback that called after the first init message, with the error (if there is one)
  * `inactivityTimeout?: number` : how long the client should wait in ms, when there are no active subscriptions, before disconnecting from the server. Set to 0 to disable this behavior. (default 0)

### fragment(_string_ name, _array_ includes, _string_ query)
_Fragment for Graphql-Query_



## Example-Usage

```javascript
const endpoint = 'http://url-to-endpoint.com'; //Url to endpoint
const definitions = require('./definitions');
/* For usage in browser environment */
var bgc = require('best-graphql-client/browser')(endpoint, definitions);
/* For usage in nodejs environment */
var bgc = require('best-graphql-client/nodejs')(endpoint, definitions);

/* All tags with all fields but without connected objects */
var stations = await bgc.get('tags');

/* All tags with parameters, all fields but without connected objects */
var tags = await bgc.get('tags', {orderBy: 'name_ASC'});

/* All tags with only field 'name' and connected object 'tagCategory' */
var tags = await bgc.get('tags', {orderBy: 'name_ASC'}, ['tagCategory'], 'name');
/* Same as */
var tags = await bgc.get('tags', {orderBy: 'name_ASC'}, 'name tagCategory { id name }');

/* All tags with the field 'name' but without connected objects */
var tags = await bgc.get('tags', {}, 'name');

/* All tags with all fields and all connected objects with all their fields */
var tags = await bgc.get('tags', {orderBy: 'name_ASC'}, ['*'])

/* posts: includes the fields of all connected objects and for the comments it includes also all the fields of the user */
var posts = await bgc.get('posts', {where: {title: "Your title"}}, ["*", {comments: ["user"]}])
/* The same but as fragments */
var posts = await bgc.get('posts', {where: {title: "Your title"}}, ["*|fragment", {"comments|fragment": ["user"]}])

/* Create tag */
var res = await bgc.mutate('createTag', {data: { name: "TESTING" }})
