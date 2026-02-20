const path = require('path')

function resolve(dir) {
  return path.join(__dirname, dir)
}

module.exports = {
  css: {
    loaderOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  },

  devServer: {
    port: 8080,
    proxy: {
      '/sub': {
        target: process.env.BACKEND_API_URL || process.env.VUE_APP_SUBCONVERTER_DEFAULT_BACKEND || 'https://url.v1.mk',
        changeOrigin: true,
        secure: true,
        ws: true
      },
      '/version': {
        target: process.env.BACKEND_API_URL || process.env.VUE_APP_SUBCONVERTER_DEFAULT_BACKEND || 'https://url.v1.mk',
        changeOrigin: true,
        secure: true,
        ws: true
      }
    }
  },

  chainWebpack: config => {
    // set svg-sprite-loader
    config.module
      .rule('svg')
      .exclude.add(resolve('src/icons'))
      .end()
    config.module
      .rule('icons')
      .test(/\.svg$/)
      .include.add(resolve('src/icons'))
      .end()
      .use('svg-sprite-loader')
      .loader('svg-sprite-loader')
      .options({
        symbolId: 'icon-[name]'
      })
      .end()
  }
};