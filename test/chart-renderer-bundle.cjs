const path = require('node:path');
const webpack = require('webpack');

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error('Usage: node test/chart-renderer-bundle.cjs <output-path>');
}

webpack({
  context: path.resolve(__dirname, '..'),
  entry: path.resolve(__dirname, 'chart-renderer-harness.js'),
  output: { path: path.resolve(outputPath), filename: 'chart-renderer-harness.js' },
  mode: 'development',
  devtool: false,
  target: 'web',
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
  }
});
