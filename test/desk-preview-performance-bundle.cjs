const path = require('node:path');
const webpack = require('webpack');
const plugins = [new webpack.NormalModuleReplacementPlugin(
  /^\.\/desk-native$/, path.join(__dirname, 'fixtures/desk-native-performance.js'),
)];
// A temporary source copy can reproduce the old regression without changing
// the repository or adding a production configuration option.
if (process.env.DESK_PREVIEW_PERF_VIEW) plugins.push(new webpack.NormalModuleReplacementPlugin(
  /^\.\.\/src\/desk-view$/, path.resolve(process.env.DESK_PREVIEW_PERF_VIEW),
));
webpack({
  context: path.join(__dirname, '..'),
  entry: path.join(__dirname, 'desk-harness.js'),
  output: { filename: 'harness.js', path: path.resolve(process.argv[2] || '/tmp/nautilus-desk-preview-performance') },
  mode: 'development', devtool: false, target: 'web', plugins,
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ colors: false }));
    process.exitCode = 1;
  }
});
