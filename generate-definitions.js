const fs = require('fs');
const bgc = require('./nodejs')(process.env.ENDPOINT);
var name = process.env.NAME || 'definitions';
var filename = name + '.js';
var folder = process.env.FOLDER || __dirname + '/../..';
var fullpath = folder + '/' + filename;

const introspection = `query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        args {
          ...InputValue
        }
        locations
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }

  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }`;

var subscriptions = {}, mutations = {}, queries = {}, allTypes = {};
//let rawdata = fs.readFileSync('schema.json'); 
bgc.get(introspection).then((data) => {
  let schema = data;
  console.log(schema);

  let types = schema.types;
  for (var t of types) {
    if (t.kind == 'OBJECT' && !['Query', 'Mutation', 'Subscription'].includes(t.name) && !t.name.startsWith('_')) {
      //console.log('---'+t.name, t);
      doStuff(t);
    }
    if (t.name == 'Mutation') {
      for (var f of t.fields) {
        mutations[f.name] = getArgsAndFields(f);
      }
    }

    if (t.name == 'Query') {
      for (var f of t.fields) {
        queries[f.name] = getArgsAndFields(f);
      }
    }

    if (t.name == 'Subscription') {
      for (var f of t.fields) {
        subscriptions[f.name] = getArgsAndFields(f);
      }
    }
  }
  /* for (var type in allTypes) {
    for (var key of Object.keys(allTypes[type].availableInc)) {
      var inc = allTypes[type].availableInc[key];
      //console.log(key, inc);
      if (!allTypes[inc].fields.match(/(^| )id( |$)/)) {
        //allTypes[type].fields += ' ' + inc + '{' + allTypes[inc].fields + '}';
        //delete allTypes[type].availableInc[inc];
      }
    }
  } */
  const definitions = { entities: allTypes, mutation: mutations, query: queries, subscription: subscriptions };
  if (process.env.TEST) {
    fs.writeFileSync(__dirname + '/' + filename, 'module.exports = ' + JSON.stringify(definitions));
  }
  if (!process.env.TEST) {
    fs.writeFileSync(fullpath, 'module.exports = ' + JSON.stringify(definitions));
  }
  //fs.writeFileSync(__dirname + '/test-definitions.json', JSON.stringify(definitions));
  var message = 'definitions stored to ' + fullpath + ', use require("./' + name + '") to include them into the client.';
  console.log("\x1b[32m", message, "\x1b[0m");
})

function doStuff(type) {
  var fields = type.fields.map(parseFields).filter((f) => !!f).join(' ');
  var includes = type.fields.map(parseIncludes).filter((f) => !!f).reduce((obj, curr) => {
    obj[curr[0]] = curr[1];
    return obj;
  }, {});
  var entity = type.type ? parseType(type.type) : type.name;
  var name = entity[0].toLowerCase() + entity.substr(1);
  allTypes[name] = {
    entity,
    fields,
    availableInc: includes
  }
}

function getArgsAndFields(type) {
  var fields = parseType(type.type);
  fields = fields[0].toLowerCase() + fields.substr(1);

  var args = type.args.reduce((obj, curr) => {
    var type = parseArgs(curr);
    obj[curr.name] = type;
    return obj;
  }, {});
  return [args, fields];
}


function parseArgs(field) {
  return parseType(field.type, 'name', true);
}

function parseFields(field) {
  const ar = ['OBJECT', 'LIST'];
  var kind = parseType(field.type, 'kind');
  if (ar.includes(kind)) return false;
  return field.name
}

function parseIncludes(field) {
  const ar = ['OBJECT', 'LIST'];
  var kind = parseType(field.type, 'kind');
  var type = parseType(field.type);
  if (!ar.includes(kind)) return false;
  if (field.name) return [field.name, {
    type: type[0].toLowerCase() + type.substr(1), args: field.args.reduce((obj, curr) => {
      var type = parseArgs(curr);
      obj[curr.name] = type;
      return obj;
    }, {})
  }];
}

function parseType(type, what = 'name', asString = false) {
  var res = '';
  if (!type) return '';
  if (type.name) return type[what];
  res = parseType(type.ofType, what, asString);
  if (asString) {
    if (type.kind == 'NON_NULL') res += '!';
    if (type.kind == 'LIST') res = '[' + res + ']';
  }
  return res;
}

