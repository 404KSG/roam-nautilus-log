// Minimal EDN attribute/map selection for synthetic public-pull fixtures.
// Never returns attributes absent from the requested projection.
const cache = new Map();
function selection(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  const tokens = pattern.match(/[\[\]{}]|:[\w/-]+|\*/g) || [];
  const take = expected => { if (tokens.shift() !== expected) throw Error('Unsupported fixture pull pattern'); };
  function parse() {
    take('['); const fields = {};
    while (tokens[0] !== ']') {
      if (!tokens.length) throw Error('Unclosed fixture pull');
      const token = tokens.shift();
      if (token === '{') { const name = tokens.shift().slice(1); fields[name] = parse(); take('}'); }
      else fields[token === '*' ? '*' : token.slice(1)] = null;
    }
    take(']'); return fields;
  }
  const fields = parse(); if (tokens.length) throw Error('Unexpected fixture pull suffix');
  cache.set(pattern, fields); return fields;
}
function projectPull(pattern, entity, expand = value => value) {
  function project(value, fields) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
    value = expand(value);
    const result = {};
    for (const [name, nested] of Object.entries(fields)) {
      if (name === '*') { Object.assign(result, value); continue; }
      const key = Object.hasOwn(value, name) ? name : Object.hasOwn(value, ':' + name) ? ':' + name : null;
      if (!key) continue;
      const v = value[key];
      result[key] = nested ? Array.isArray(v) ? v.map(row => project(row, nested)) : project(v, nested) : v;
    }
    return result;
  }
  return project(entity, selection(pattern));
}
module.exports = { projectPull };
