const { screen, BrowserWindow, ipcMain, dialog, ipcRenderer, app, session } = require('electron')
const { join } = require('path')
const { URL } = require('url')
const toUri = require('multiaddr-to-uri')
const serve = require('electron-serve')
const os = require('os')
const openExternal = require('./open-external')
const logger = require('../common/logger')
const store = require('../common/store')
const dock = require('../utils/dock')
const { VERSION, ELECTRON_VERSION } = require('../common/consts')
const createToggler = require('../utils/create-toggler')
const { LocalFileData } = require('get-file-object-from-local-path')

serve({ scheme: 'webui', directory: join(__dirname, '../../assets/webui') })

const CONFIG_KEY = 'openWebUIAtLaunch'

const createWindow = () => {
  const dimensions = screen.getPrimaryDisplay()
  console.log('loacal preload path : ', join(__dirname, 'preload.js'))
  const window = new BrowserWindow({
    title: 'IPFS Retro Desktop',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    width: store.get('window.width', dimensions.width < 1440 ? dimensions.width : 1440),
    height: store.get('window.height', dimensions.height < 900 ? dimensions.height : 900),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRendererProcessReuse: true,
      allowRunningInsecureContent: false,
      // enableRemoteModule: process.env.NODE_ENV === 'test', // https://github.com/electron-userland/spectron/pull/738#issuecomment-754810364
      // nodeIntegration: process.env.NODE_ENV === 'test' && false
      nodeIntegration: false
    }
  })

  // open devtools with: DEBUG=ipfs-desktop ipfs-desktop
  if (process.env.DEBUG && process.env.DEBUG.match(/ipfs-desktop/)) {
    window.webContents.openDevTools()
  }
  window.webContents.openDevTools()
  window.webContents.on('crashed', event => {
    logger.error(`[web ui] crashed: ${event.toString()}`)
  })

  window.webContents.on('unresponsive', event => {
    logger.error(`[web ui] unresponsive: ${event.toString()}`)
  })

  window.on('resize', () => {
    const dim = window.getSize()
    store.set('window.width', dim[0])
    store.set('window.height', dim[1])
  })

  window.on('close', (event) => {
    event.preventDefault()
    window.hide()
    dock.hide()
    logger.info('[web ui] window hidden')
  })

  app.on('before-quit', () => {
    // Makes sure the app quits even though we prevent
    // the closing of this window.
    window.removeAllListeners('close')
  })

  window.ipcRenderer = ipcRenderer

  return window
}

// Converts a Multiaddr to a valid value for Origin HTTP header
const apiOrigin = (apiMultiaddr) => {
  // Return opaque origin when there is no API yet
  // https://html.spec.whatwg.org/multipage/origin.html#concept-origin-opaque
  if (!apiMultiaddr) return 'null'
  // Return the Origin of HTTP API
  const apiUri = toUri(apiMultiaddr, { assumeHttp: true })
  return new URL(apiUri).origin
}

let mainWindow

module.exports = async function (ctx) {
  if (store.get(CONFIG_KEY, null) === null) {
    // First time running this. Enable opening ipfs-webui at app launch.
    // This accounts for users on OSes who may have extensions for
    // decluttering system menus/trays, and thus have no initial "way in" to
    // Desktop upon install:
    // https://github.com/ipfs-shipyard/ipfs-desktop/issues/1741
    store.set(CONFIG_KEY, true)
  }

  createToggler(CONFIG_KEY, async ({ newValue }) => {
    store.set(CONFIG_KEY, newValue)
    return true
  })

  openExternal()

  const window = createWindow(ctx)
  mainWindow = window
  let apiAddress = null

  ctx.webui = window

  const url = new URL('/', 'webui://-')
  url.hash = '/blank'
  url.searchParams.set('deviceId', ctx.countlyDeviceId)

  ctx.launchWebUI = (path, { focus = true, forceRefresh = false } = {}) => {
    // if (forceRefresh) window.webContents.reload()
    if (forceRefresh) window.reload()
    if (!path) {
      logger.info('[web ui] launching web ui')
    } else {
      logger.info(`[web ui] navigate to ${path}`)
      url.hash = path
      // window.webContents.loadURL(url.toString())
      window.loadURL(url.toString())
    }
    if (focus) {
      window.show()
      window.focus()
      dock.show()
    }
    // load again: minimize visual jitter on windows
    // if (path) window.webContents.loadURL(url.toString())
    if (path) window.loadURL(url.toString())
  }

  function updateLanguage () {
    url.searchParams.set('lng', store.get('language'))
  }

  ipcMain.on('ipfsd', async () => {
    const ipfsd = await ctx.getIpfsd(true)

    if (ipfsd && ipfsd.apiAddr !== apiAddress) {
      apiAddress = ipfsd.apiAddr
      url.searchParams.set('api', apiAddress)
      updateLanguage()
      window.loadURL(url.toString())
    }
  })

  ipcMain.on('config.get', () => {
    window.webContents.send('config.changed', {
      platform: os.platform(),
      config: store.store
    })
  })

  ipcMain.on('window.close', () => {
    window.close()
  })

  ipcMain.on('window.greetz', () => {
    // const greetzWindow = new BrowserWindow({
    //   show: false,
    //   frame: false,
    //   fullscreenable: false,
    //   resizable: false,
    //   width: 480,
    //   height: 300
    // })

    // window.hide()
    // greetzWindow.show()

    // greetzWindow.on('closed', () => { window.show() })
    // greetzWindow.loadURL('webui://-/greetz')
    console.log('greets selected from webui at ipcMain.ON')
    return 123234234
  })

  ipcMain.on('request-open-sync-path', () => {
    console.log(' clicked open sync path on web UI m @ ipcREnder.on.....')
  })

  // Avoid setting CORS by acting like /webui loaded from API port
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders.Origin = apiOrigin(apiAddress)
    details.requestHeaders['User-Agent'] = `ipfs-desktop/${VERSION} (Electron ${ELECTRON_VERSION})`
    callback({ cancel: false, requestHeaders: details.requestHeaders }) // eslint-disable-line
  })

  // modify CORS preflight on the fly
  const webuiOrigin = 'webui://-'
  const acao = 'Access-Control-Allow-Origin'
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders } = details
    // If Access-Control-Allow-Origin header is returned, override it to match webuiOrigin
    if (responseHeaders && responseHeaders[acao]) {
      responseHeaders[acao] = webuiOrigin
    }
    // eslint-disable-next-line
    callback({ responseHeaders })
  })

  return new Promise(resolve => {
    window.once('ready-to-show', (e) => {
      logger.info('[web ui] window ready')

      if (store.get(CONFIG_KEY)) {
        const splashWindow = new BrowserWindow({
          show: false,
          frame: false,
          fullscreenable: false,
          resizable: false,
          width: 480,
          height: 300,
          webPreferences: {
            preload: join(__dirname, 'preload.js'),
            webSecurity: false,
            allowRendererProcessReuse: true,
            allowRunningInsecureContent: false,
            // enableRemoteModule: process.env.NODE_ENV === 'test', // https://github.com/electron-userland/spectron/pull/738#issuecomment-754810364
            // nodeIntegration: process.env.NODE_ENV === 'test' && false
            nodeIntegration: false
          }
        })
        splashWindow.ipcRenderer = ipcRenderer
        splashWindow.loadURL('webui://-/splash')
        splashWindow.once('ready-to-show', () => {
          splashWindow.show()
          setTimeout(() => {
            splashWindow.close()

            console.log('>>>>>> ctx lunch : ')
            ctx.launchWebUI('/')
          }, 3000)
        })
      }
      resolve()
    })

    updateLanguage()
    console.log('.>> load web url : ', url.toString())
    window.loadURL(url.toString())
  })
}

module.exports.CONFIG_KEY = CONFIG_KEY

let syncWatcher

function startFileWatcher (_path, _window) {
  console.log('&&&&&&  start file watcher >>> ')

  const chokidar = require('chokidar')
  if (syncWatcher) {
    syncWatcher.close()
  }

  syncWatcher = chokidar.watch(_path, {
    ignored: /(^|[/\\])\../,
    persistent: true
  })

  function onWatcherReady () {
    console.info('From here check cehck for real changes on folder')
  }

  syncWatcher
    .on('add', path => {
      console.log('File', path, 'has been added')
      const fileData = new LocalFileData(path)
      console.log('file data : ', [...fileData.arrayBuffer])
      _window?.webContents.send('synced_local_add_file', path, fileData)
    })
    .on('addDir', path => {
      console.log('Directory', path, 'has been added')
      if (_window) {
        _window.webContents.send('synced_local_add_dir', path)
        // ipcMain.send('synced_local_addDir', path)
      }
    })
    .on('change', path => {
      console.log('File', path, 'has been changed')
      _window?.webContents.send('synced_local_change', path)
    })
    .on('unlink', path => {
      console.log('File', path, 'has been removed')
      _window?.webContents.send('synced_local_delete_file', path)
    })
    .on('unlinkDir', path => {
      console.log('Folder', path, 'has been removed')
      _window?.webContents.send('synced_local_delete_dir', path)
    })
    .on('error', err => {
      console.log('Error happened', err)
    })
    .on('ready', onWatcherReady)
    .on('raw', (event, path, details) => {
      console.log('Raw event info: ', event, path, details)
    })
}

function selectLocalPath () {
  const path = dialog.showOpenDialogSync({ properties: ['openDirectory'], title: 'Select synced folder path.' })
  store.set('syncPath', path)
  return path
}

function checkSyncPathAndWatch () {
  let path = store.get('syncPath')
  if (!path) {
    path = selectLocalPath()
  }
  console.log('Sync folder path >>>> : ', path)
  // startFileWatcher('/Users/apple/Downloads/')
  startFileWatcher(path, mainWindow)
  return path
}

ipcMain.handle('invoke-select-local-path', (event, ...args) => {
  const path = selectLocalPath()
  startFileWatcher(path, mainWindow)
  return path
})

ipcMain.handle('invoke-path-watch', (event, ...args) => {
  const path = store.get('syncPath')
  if (path) {
    return checkSyncPathAndWatch()
  } else {
    return undefined
  }
})

ipcMain.handle('invoke-sync-path-fetch', async (event, someArgument) => {
  return store.get('syncPath')
})

ipcMain.handle('invoke-sync-path-select', async (event, someArgument) => {
  return store.get('syncPath')
})

ipcMain.on('sync-message', async (event, data, arg) => {
  console.log('ipcMain.on Sync-Message : ', data, arg)
  return store.get('syncPath')
})
