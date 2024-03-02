const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/index.browser.js',
  output: {
    filename: 'build.js',
    path: path.resolve(__dirname, 'dist'),
    library: 'EBB',
    libraryTarget: 'umd',
    globalObject: 'this',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: ['babel-loader'],
      },
    ],
  },
};
