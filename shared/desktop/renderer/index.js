// @flow
/*
 * The main renderer. Holds the global store. When it changes we send it to the main thread which then sends it out to subscribers
 */
import '../../dev/user-timings'
import Main from '../../app/main.desktop'
import * as AppGen from '../../actions/app-gen'
import * as DevGen from '../../actions/dev-gen'
import * as NotificationsGen from '../../actions/notifications-gen'
import * as React from 'react'
import * as ConfigGen from '../../actions/config-gen'
import ReactDOM from 'react-dom'
import RemoteManager from './remote-manager.desktop'
import Root from './container'
import configureStore from '../../store/configure-store'
import electron, {ipcRenderer} from 'electron'
import {makeEngine} from '../../engine'
import hello from '../../util/hello'
import loadPerf from '../../util/load-perf'
import routeDefs from '../../app/routes'
import {AppContainer} from 'react-hot-loader'
import {disable as disableDragDrop} from '../../util/drag-drop'
import {getUserImageMap, loadUserImageMap, getTeamImageMap, loadTeamImageMap} from '../../util/pictures'
import {initAvatarLookup, initAvatarLoad} from '../../common-adapters'
import merge from 'lodash/merge'
import throttle from 'lodash/throttle'
import {selector as menubarSelector} from '../../menubar/selector'
import {selector as remotePurgeMessageSelector} from '../../pgp/selector'
import {selector as unlockFoldersSelector} from '../../unlock-folders/selector'
import {setRouteDef} from '../../actions/route-tree'
import {setupContextMenu} from '../app/menu-helper'
import {setupSource} from '../../util/forward-logs'
import flags from '../../util/feature-flags'
import InputMonitor from './inputmonitor'

let _store
function setupStore() {
  if (!_store) {
    _store = configureStore()

    if (flags.admin) {
      window.DEBUGStore = _store
    }
  }

  return _store
}

function setupAvatar() {
  initAvatarLookup(getUserImageMap, getTeamImageMap)
  initAvatarLoad(loadUserImageMap, loadTeamImageMap)
}

function setupApp(store) {
  setupSource()
  disableDragDrop()
  const eng = makeEngine(store.dispatch)
  loadPerf()
  setupAvatar()

  if (__DEV__ && process.env.KEYBASE_LOCAL_DEBUG) {
    require('devtron').install()
  }

  setupContextMenu(electron.remote.getCurrentWindow())

  // Tell the main window some remote window needs its props
  console.log('aaaa main app starting to listen for remoteWindowWantsProps')
  ipcRenderer.on('remoteWindowWantsProps', (event, component, selectorParams) => {
    console.log('dispatching action')
    store.dispatch({type: 'remote:needProps', payload: {component, selectorParams}})
  })
  ipcRenderer.on('dispatchAction', (event, action) => {
    // we MUST convert this else we'll run into issues with redux. See https://github.com/rackt/redux/issues/830
    // This is because this is touched due to the remote proxying. We get a __proto__ which causes the _.isPlainObject check to fail. We use
    // _.merge() to get a plain object back out which we can send
    setImmediate(() => {
      try {
        store.dispatch(merge({}, action))
      } catch (_) {}
    })
  })

  // After a delay, see if we're connected, and try starting keybase if not
  setTimeout(() => {
    if (!eng.hasEverConnected()) {
      ipcRenderer.send('kb-service-check')
    }
  }, 3 * 1000)

  // Run installer
  ipcRenderer.on('installed', (event, message) => {
    store.dispatch(ConfigGen.createReadyForBootstrap())
    store.dispatch(ConfigGen.createBootstrap({}))
  })
  ipcRenderer.send('install-check')

  var inputMonitor = new InputMonitor(function(isActive) {
    store.dispatch(AppGen.createChangedActive({userActive: isActive}))
  })
  inputMonitor.startActiveTimer()

  window.addEventListener('focus', () => {
    inputMonitor.goActive()
    store.dispatch(AppGen.createChangedFocus({appFocused: true}))
  })
  window.addEventListener('blur', () => {
    store.dispatch(AppGen.createChangedFocus({appFocused: false}))
  })

  const _menubarSelector = menubarSelector()
  const _unlockFoldersSelector = unlockFoldersSelector()
  const _remotePurgeMessageSelector = remotePurgeMessageSelector()

  const subsetsRemotesCareAbout = store => {
    return {
      tracker: store.tracker,
      menubar: _menubarSelector(store),
      unlockFolder: _unlockFoldersSelector(store),
      pgpPurgeMessage: _remotePurgeMessageSelector(store),
    }
  }

  let _currentStore
  store.subscribe(
    throttle(() => {
      let previousStore = _currentStore
      _currentStore = subsetsRemotesCareAbout(store.getState())

      if (JSON.stringify(previousStore) !== JSON.stringify(_currentStore)) {
        ipcRenderer.send('stateChange', {
          ...store.getState(),
          // this is a HACK workaround where we can't send immutable over the wire to the main thread (and out again).
          // I have a much better way to handle this we can prioritize post-mobile launch (CN)
          notifications: _currentStore.menubar.notifications,
        })
      }
    }, 1000)
  )

  // Handle notifications from the service
  store.dispatch(NotificationsGen.createListenForNotifications())

  // Introduce ourselves to the service
  hello(process.pid, 'Main Renderer', process.argv, __VERSION__, true) // eslint-disable-line no-undef

  // $FlowIssue doesn't like the require
  store.dispatch(DevGen.createUpdateDebugConfig({config: require('../../local-debug-live')}))
}

const FontLoader = () => (
  <div style={{height: 0, overflow: 'hidden', width: 0}}>
    <p style={{fontFamily: 'kb'}}>kb</p>
    <p style={{fontFamily: 'Source Code Pro', fontWeight: 400}}>source code pro 400</p>
    <p style={{fontFamily: 'Source Code Pro', fontWeight: 600}}>source code pro 600</p>
    <p style={{fontFamily: 'OpenSans', fontWeight: 400}}>open sans 400</p>
    <p style={{fontFamily: 'OpenSans', fontStyle: 'italic', fontWeight: 400}}>open sans 400 i</p>
    <p style={{fontFamily: 'OpenSans', fontWeight: 600}}>open sans 600</p>
    <p style={{fontFamily: 'OpenSans', fontStyle: 'italic', fontWeight: 600}}>open sans 600 i</p>
    <p style={{fontFamily: 'OpenSans', fontWeight: 700}}>open sans 700</p>
  </div>
)

function render(store, MainComponent) {
  ReactDOM.render(
    <AppContainer>
      <Root store={store}>
        <div style={{display: 'flex', flex: 1}}>
          <RemoteManager />
          <FontLoader />
          <MainComponent />
        </div>
      </Root>
    </AppContainer>,
    // $FlowIssue wants this to be non-null
    document.getElementById('root')
  )
}

function setupRoutes(store) {
  store.dispatch(setRouteDef(routeDefs))
}

function setupHMR(store) {
  if (!module || !module.hot || typeof module.hot.accept !== 'function') {
    return
  }

  module.hot &&
    module.hot.accept(['../../app/main.desktop', '../../app/routes'], () => {
      store.dispatch(setRouteDef(require('../../app/routes').default))
      try {
        store.dispatch(DevGen.createUpdatehmrReloading({reloading: true}))
        const NewMain = require('../../app/main.desktop').default
        render(store, NewMain)
      } finally {
        setTimeout(() => store.dispatch(DevGen.createUpdatehmrReloading({reloading: false})), 10e3)
      }
    })

  module.hot &&
    module.hot.accept('../../local-debug-live', () => {
      // $FlowIssue doesn't like the require
      store.dispatch(DevGen.createUpdateDebugConfig({config: require('../../local-debug-live')}))
    })

  module.hot && module.hot.accept('../../common-adapters/index.js', () => {})
}

function load() {
  const store = setupStore()
  setupRoutes(store)
  setupApp(store)
  setupHMR(store)
  render(store, Main)
}

window.load = load
