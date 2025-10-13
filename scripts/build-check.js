const path = require('path');

function main() {
  const root = path.resolve(__dirname, '..');
  process.env.SKIP_SERVER_START = process.env.SKIP_SERVER_START || '1';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DATABASE_PATH = process.env.DATABASE_PATH || ':memory:';

  const serverPath = path.join(root, 'server.js');
  const resolved = require.resolve(serverPath);
  delete require.cache[resolved];

  const app = require(resolved);
  if (typeof app !== 'function') {
    throw new Error('Express application was not returned by server module.');
  }
  if (!app.use || !app.listen) {
    throw new Error('Loaded server does not expose expected Express interface.');
  }
  console.log('Server bootstrap check passed.');
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

module.exports = { main };
