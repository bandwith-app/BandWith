import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Runs callbacks when the app comes back to the front. While the app is in
 * the background the phone suspends the page and its realtime connection,
 * so messages and notifications that arrived meanwhile never reach the open
 * lists: they refetch here instead of waiting for the next screen change.
 * Native apps listen to appStateChange, the web to visibilitychange; one
 * resume fires the callbacks once.
 */
type Callback = () => void;

const callbacks = new Set<Callback>();
let bound = false;
let lastFired = 0;

function fire() {
  const now = Date.now();
  if (now - lastFired < 1000) return;
  lastFired = now;
  callbacks.forEach((cb) => {
    try {
      cb();
    } catch {
      /* one listener must not stop the others */
    }
  });
}

function bind() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  if (Capacitor.isNativePlatform()) {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) fire();
    }).catch(() => {
      bound = false;
    });
    return;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fire();
  });
}

export function onAppResume(cb: Callback): () => void {
  bind();
  callbacks.add(cb);
  return () => {
    callbacks.delete(cb);
  };
}
