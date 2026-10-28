const { execFileSync } = require('node:child_process');
const { DefinePlugin } = require('webpack');
let sourceRevision = 'unknown';
try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[a-f0-9]{40}$/.test(sha)) {
        const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        sourceRevision = sha + (dirty ? '-dirty' : '');
    }
} catch (_error) { /* A source archive may have no Git metadata. */ }

module.exports = {
    plugins: [new DefinePlugin({ __NAUTILUS_SOURCE_REVISION__: JSON.stringify(sourceRevision) })],
    externals: {
        react: "React",
        "chrono-node": "ChronoNode"
    },
    externalsType: "window",
    entry: './src/index.js',
    output: {
        filename: 'extension.js',
        path: __dirname,
        library: {
            type: "module",
        }
    },
    experiments: {
        outputModule: true,
    },
    mode: "production",
    module: {
        rules: [
            {
            test: /\.cljs$/,
            type: 'asset/source',
            },
        ],
      },
};
