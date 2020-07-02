# Best Javascript GraphQL Client

Just provide the url of any GraphQL endpoint to generate the information the client needs to know and be ready to write queries like this:

```javascript
bgc.get('posts', {where: {title: "Your title"}}, ["author", {comments: ["user"]}])
```

By the way: The client supports subscriptions out of the box:

```javascript
bgc.subscribe(function(data) { console.log(data); }, 'notification', {where: {user: {id: 1}}});
```

This client is the best for you, if you like it short and elegant. It uses the ApolloClient in the background. 

## Installation

### Add this repo to you package.json:

_*dependencies:*_

- "best-graphql-client": "git+https://url-to-this-repo.git"

### Add this script to you package.json: 

_*scripts:*_

- "generate": "npm run --prefix node_modules/best-graphql-client generate"


```bash
npm install
```

### Generate definitions for endpoint:
```bash
CORE=https://url-to-endpoint npm run generate
```

## Functions

The following functions can be used to query a GraphlQL endpoint. 

### get(_string_ name [, _object_ parameters [, _array_ includes] [, _string_ fields]])
_Graphql-Query_: 
`query do(parameters) { name(parameters) { fields + includes } }`

If 3 parameters are given: If the 3rd is a string, it is used as the `fields`.
If `fields` are empty, all fields are returned.
`includes` can also be '*', then all connected objects are returned. (See Example-Usage)

### mutate(_string_ name [, _object_ parameters [, _array_ includes] [, _string_ fields]])
_Graphql-Mutation_: (Same as `get`, just as `mutation`)

### fragment(_string_ name, _array_ includes, _string_ query)
_Fragment for Graphql-Query_

## Example-Usage

```javascript
const endpoint = 'http://url-to-endpoint.com'; //Url to endpoint
const definitions = require('./definitions');
var bgc = require('best-graphql-client')(endpoint, definitions);

/* All tags with all fields but without connected objects */
var stations = await bcg.get('tags');

/* All tags with parameters, all fields but without connected objects */
var tags = await bcg.get('tags', {orderBy: 'name_ASC'});

/* All tags with only field 'name' and connected object 'tagCategory' */
var tags = await bcg.get('tags', {orderBy: 'name_ASC'}, ['tagCategory'], 'name');

/* All tags with the field 'name' but without connected objects */
var tags = await bcg.get('tags', {}, 'name');

/* All tags with all fields and all connected objects with all their fields */
var tags = await bcg.get('tags', {orderBy: 'name_ASC'}, '*')

/* posts: includes the fields of all connected objects and for the comments it includes also all the fields of the user */
var posts = await bgc.get('posts', {where: {title: "Your title"}}, ["*", {comments: ["user"]}])

/* Create tag */
var res = await bcg.mutate('createTag', {data: { name: "TESTING" }})
