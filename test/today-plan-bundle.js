#!/usr/bin/env node
const path = require('path');
const webpack = require('webpack');

const outDir = path.resolve(process.argv[2] || '/tmp/nautilus-today-plan-verify');

webpack({
  context: path.join(__dirname, '..'),
  entry: path.join(__dirname, 'today-plan-harness.js'),
  output: {
    filename: 'harness.js',
    path: outDir,
  },
  mode: 'development',
  devtool: false,
  target: 'web',
}, (err, stats) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  if (stats.hasErrors()) {
    console.error(stats.toString({ colors: false }));
    process.exit(1);
  }
  process.stdout.write(`${path.join(outDir, 'harness.js')}\n`);
});
