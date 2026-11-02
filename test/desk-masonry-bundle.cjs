const path = require('node:path');
const webpack = require('webpack');
webpack({
  context: path.join(__dirname, '..'),
  entry: path.join(__dirname, 'desk-masonry-harness.js'),
  output: { filename: 'masonry.js', path: path.resolve(process.argv[2] || '/tmp/nautilus-desk-masonry') },
  mode: 'development', devtool: false, target: 'web',
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ colors: false }));
    process.exitCode = 1;
  }
});
