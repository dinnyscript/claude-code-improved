// A small in-memory stand-in for the parts of the chrome.* API the extension uses.
const { createMemoryStorage } = require('../../src/lib/stats.js');

function listenerSet() {
  const fns = [];
  return {
    addListener: (fn) => fns.push(fn),
    removeListener: (fn) => {
      const i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    },
    hasListeners: () => fns.length > 0,
    fns,
  };
}

function createFakeChrome({ sync = {}, local = {}, tabs = [] } = {}) {
  const onChanged = listenerSet();

  function area(name, initial) {
    const mem = createMemoryStorage({ initial });
    return {
      get: (keys) => mem.get(keys),
      async set(obj) {
        const before = await mem.get(Object.keys(obj));
        await mem.set(obj);
        const changes = {};
        for (const [k, v] of Object.entries(obj)) changes[k] = { oldValue: before[k], newValue: v };
        onChanged.fns.forEach((fn) => fn(changes, name));
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const before = await mem.get(list);
        await mem.remove(list);
        const changes = {};
        for (const k of list) changes[k] = { oldValue: before[k], newValue: undefined };
        onChanged.fns.forEach((fn) => fn(changes, name));
      },
    };
  }

  const onMessage = listenerSet();
  const sent = [];
  const notifications = [];
  const cleared = [];
  const badge = { text: '', color: null };
  const tabUpdates = [];
  const windowUpdates = [];
  const alarms = [];
  let openedOptions = 0;

  const chrome = {
    storage: { sync: area('sync', sync), local: area('local', local), onChanged },
    runtime: {
      id: 'fake-extension-id',
      onMessage,
      onInstalled: listenerSet(),
      onStartup: listenerSet(),
      getURL: (p) => `chrome-extension://fake-extension-id/${p.replace(/^\//, '')}`,
      openOptionsPage: async () => {
        openedOptions++;
      },
      sendMessage(message, sender = { tab: { id: 7, windowId: 3, active: true } }) {
        sent.push(message);
        return new Promise((resolve) => {
          let async = false;
          for (const fn of onMessage.fns) {
            if (fn(message, sender, resolve) === true) async = true;
          }
          if (!async) resolve(undefined);
        });
      },
    },
    notifications: {
      onClicked: listenerSet(),
      create: async (id, opts) => {
        notifications.push({ id, ...opts });
        return id;
      },
      clear: async (id) => {
        cleared.push(id);
        return true;
      },
    },
    tabs: {
      query: async () => tabs,
      update: async (id, props) => {
        tabUpdates.push({ id, ...props });
      },
      create: async () => {},
    },
    windows: {
      update: async (id, props) => {
        windowUpdates.push({ id, ...props });
      },
    },
    action: {
      setBadgeText: async ({ text }) => {
        badge.text = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        badge.color = color;
      },
    },
    alarms: {
      onAlarm: listenerSet(),
      create: (name, info) => alarms.push({ name, ...info }),
    },
  };

  return {
    chrome,
    sent,
    notifications,
    cleared,
    badge,
    tabUpdates,
    windowUpdates,
    alarms,
    openedOptionsCount: () => openedOptions,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

module.exports = { createFakeChrome, flush };
