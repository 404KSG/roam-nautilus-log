const { exclusiveLocks } = require('./managed-template-graph.cjs');

function installTestHostLocks(host, locks = exclusiveLocks()) {
  if (!host) return locks;
  const navigator = host.navigator && typeof host.navigator === 'object' ? host.navigator : {};
  host.navigator = { ...navigator, locks };
  return locks;
}

module.exports = { exclusiveLocks, installTestHostLocks };
