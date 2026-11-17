/*
 * BandWith emulator check: test setup for the Maestro flows.
 *
 * scripts/emulator-check.sh injects this file into the DEMO build it makes for
 * the simulators (a classic <script> in <head>, so it runs before the app's
 * module). It is never part of a production build: `vite build` does not
 * know about it, and the demo build only exists in .emulator-check/build/.
 *
 * What it does, like e2e/fixtures.ts does for Playwright:
 * - a fixed clock: every run is Monday 16 Nov 2026, 10:00 device time (the
 *   demo seed dates everything relative to "today"), time flows from there;
 * - first launch after a clean install: signed in to the demo as Leo M.
 *   (admin of Velvet Static), role tours seen, English;
 * - setup links: Maestro opens
 *     app.bandwith.mobile://auth/maestro?<params>   (iOS)
 *     com.bandwith.app://auth/maestro?<params>      (Android)
 *   The app ignores them (not auth/callback, no invite or deputy token); this
 *   script applies <params> to the demo database and reloads:
 *     role=admin|member   Leo's role in the band
 *     keep=1              keep the offline cache (same device after a role
 *                         change); otherwise it is cleared, like a fresh
 *                         install of that member's phone
 *     pending=<title>     Leo's answer to that event goes back to "pending"
 *                         and the invitation pop-ups are dropped
 *     signout=1           signed out: the welcome screen (Sign in, Create
 *                         account)
 *     blur=1              closes the on-screen keyboard (no reload)
 * - closes the urgent pop-up whenever it shows up;
 * - answers Photon / Open-Meteo with canned data (e2e/support/network.ts);
 * - the keyboard probe (below): is the field being typed in in sight?
 */
(function () {
  'use strict';
  var FLAG = 'bw-maestro';
  var DB_KEY = 'bw-demo-db-v6';
  var ME = '10000001-0000-4000-8000-000000000001';

  // Fixed clock (Date only; timers untouched), same moment as the e2e suite.
  var RealDate = Date;
  var target = new RealDate(2026, 10, 16, 10, 0, 0).getTime();
  var offset;
  try {
    var saved = sessionStorage.getItem('bw-maestro-clock');
    offset = saved ? Number(saved) : target - RealDate.now();
    sessionStorage.setItem('bw-maestro-clock', String(offset));
  } catch (e) {
    offset = target - RealDate.now();
  }
  var now = function () {
    return RealDate.now() + offset;
  };
  function FakeDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!(this instanceof FakeDate)) return new RealDate(now()).toString();
    if (!args.length) return new RealDate(now());
    return new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;

  // Outside services get canned answers (e2e/support/network.ts), so a flow
  // never depends on someone else's server: venue search (Photon) returns
  // "<query> Studios" and "<query> Hall" in Milan, the weather is 14°, dry.
  var realFetch = window.fetch;
  var reply = function (body) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  window.fetch = function (input, init) {
    var href = typeof input === 'string' ? input : (input && input.url) || String(input);
    var u;
    try {
      u = new URL(href, location.href);
    } catch (e) {
      return realFetch.apply(this, arguments);
    }
    if (u.hostname === 'photon.komoot.io') {
      var q = u.searchParams.get('q') || 'Venue';
      var venues = [
        { name: q + ' Studios', street: 'Via Ventura', housenumber: '4', lon: 9.24, lat: 45.48 },
        { name: q + ' Hall', street: 'Via Tortona', housenumber: '27', lon: 9.16, lat: 45.45 },
      ];
      return reply({
        type: 'FeatureCollection',
        features: venues.map(function (v) {
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
            properties: { name: v.name, street: v.street, housenumber: v.housenumber, city: 'Milano', country: 'Italy' },
          };
        }),
      });
    }
    if (u.hostname === 'geocoding-api.open-meteo.com') {
      return reply({ results: [{ name: 'Milano', latitude: 45.46, longitude: 9.19, country: 'Italy', country_code: 'IT', admin1: 'Lombardy' }] });
    }
    if (u.hostname === 'api.open-meteo.com') {
      return reply({
        daily: {
          time: [u.searchParams.get('start_date')],
          weather_code: [1],
          temperature_2m_max: [14],
          precipitation_probability_max: [5],
          wind_speed_10m_max: [9],
        },
      });
    }
    return realFetch.apply(this, arguments);
  };

  try {
    if (!localStorage.getItem(FLAG)) {
      localStorage.setItem(FLAG, '1');
      localStorage.setItem('bw-demo-session', '1');
      localStorage.setItem('bw-role-tour-seen:admin', '1');
      localStorage.setItem('bw-role-tour-seen:member', '1');
      localStorage.setItem('bw-locale-v1', 'en');
    }
  } catch (e) {
    /* storage blocked */
  }

  function apply(url) {
    var u;
    try {
      u = new URL(url);
    } catch (e) {
      return;
    }
    if (!/maestro/.test(u.pathname + u.host)) return;
    var p = u.searchParams;
    // blur=1: close the on-screen keyboard (iOS: a tap outside a field
    // doesn't blur it in WKWebView, and Maestro's hideKeyboard can't).
    if (p.get('blur') === '1') {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      return;
    }
    var db = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    var role = p.get('role');
    if (role === 'admin' || role === 'member') {
      (db.band_members || []).forEach(function (m) {
        if (m.user_id === ME) m.role = role;
      });
    }
    if (p.get('signout') === '1') localStorage.removeItem('bw-demo-session');
    var pending = p.get('pending');
    if (pending) {
      var ev = (db.events || []).find(function (e) {
        return e.title === pending;
      });
      if (ev)
        (db.event_members || []).forEach(function (m) {
          if (m.event_id === ev.id && m.user_id === ME) {
            m.status = 'pending';
            m.responded_at = null;
          }
        });
      db.notifications = (db.notifications || []).filter(function (n) {
        return n.type !== 'event_invite';
      });
    }
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    var reload = function () {
      location.reload();
    };
    if ((role || p.get('signout') === '1') && p.get('keep') !== '1') {
      // src/lib/offline/storage.ts: IndexedDB with a localStorage fallback.
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('bw:') === 0) localStorage.removeItem(k);
      });
      var req = indexedDB.deleteDatabase('bandwith_offline_db');
      req.onsuccess = req.onerror = req.onblocked = function () {
        setTimeout(reload, 200);
      };
      setTimeout(reload, 3000);
    } else {
      setTimeout(reload, 200);
    }
  }

  // The urgent pop-up (an unanswered gig invitation or poll) shows up on its
  // own a moment after launch, at a different moment on every device, and a
  // tap meant for the screen behind it only closes it. Close it as soon as it
  // appears, like e2e/fixtures.ts does (no flow is about the pop-up itself).
  var closeLabels = ['Dismiss alert', 'Close tour'];
  var closer = function () {
    closeLabels.forEach(function (label) {
      var b = document.querySelector('[aria-label="' + label + '"]');
      if (b && !b.dataset.bwMaestroClosed) {
        b.dataset.bwMaestroClosed = '1';
        setTimeout(function () {
          b.click();
        }, 150);
      }
    });
  };
  var startObserver = function () {
    new MutationObserver(closer).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);

  // Keyboard probe. Maestro can't measure the screen, so this follows the
  // field being typed in from the moment it gets focus until it has rested
  // for a second with the on-screen keyboard up, and says what it found in a
  // 2 px status element Maestro reads by its label:
  //   "bw-kb wait"               following the field
  //   "bw-kb ok"                 in sight, uncovered, got there in one move
  //   "bw-kb fail: <why>"        no keyboard came up, the field is hidden
  //                              (below the web view's bottom, which ends at
  //                              the keyboard), covered by something else,
  //                              never came to rest, or jumped: moved one way
  //                              and then back by more than 24 px (its path
  //                              is in the message)
  var probe = null;
  var say = function (text) {
    if (!probe) {
      probe = document.createElement('div');
      probe.id = 'bw-maestro-probe';
      probe.setAttribute('role', 'status');
      probe.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.02;pointer-events:none;z-index:2147483647;font-size:1px;';
      document.body.appendChild(probe);
    }
    probe.setAttribute('aria-label', text);
    probe.textContent = text;
  };
  var isField = function (el) {
    return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  };
  var nameOf = function (el) {
    var id = el.id && document.querySelector('label[for="' + el.id + '"]');
    var label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || (id && id.textContent) || el.name || el.type || el.tagName;
    return String(label).trim().slice(0, 40);
  };
  var keyboardUp = function () {
    return document.documentElement.getAttribute('data-keyboard') === 'open';
  };
  var STEP = 100; // ms between samples
  var REST = 1000; // ms without moving (and the keyboard up) = at rest
  var LIMIT = 8000; // ms to come to rest
  var follow = null;
  var verdict = function (f) {
    var el = f.el;
    var r = el.getBoundingClientRect();
    var vh = window.visualViewport ? Math.min(window.innerHeight, window.visualViewport.height) : window.innerHeight;
    var cx = Math.max(1, Math.min(window.innerWidth - 1, r.left + Math.min(r.width / 2, 40)));
    var cy = r.top + r.height / 2;
    var name = '"' + nameOf(el) + '"';
    var why = [];
    if (!keyboardUp()) why.push('no on-screen keyboard came up');
    if (!f.rested) why.push(name + ' still moving after ' + LIMIT / 1000 + ' s');
    if (cy < 0 || cy > vh) why.push(name + ' out of sight (centre ' + Math.round(cy) + ', view ' + Math.round(vh) + ')');
    else {
      var hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el))
        why.push(name + ' covered by ' + hit.tagName.toLowerCase() + '.' + String(hit.className).split(' ')[0]);
    }
    // A jump: the field went one way, then back (more than 24 px), instead
    // of one smooth move to its place. The path lists where it rested.
    // A smaller dip before the move (the view resizing a frame ahead of the
    // scroll) passes.
    var path = [];
    f.tops.forEach(function (t) {
      if (!path.length || Math.abs(t - path[path.length - 1]) > 2) path.push(t);
    });
    var up = 0, down = 0;
    for (var i = 1; i < f.tops.length; i++) {
      var d = f.tops[i] - f.tops[i - 1];
      if (d > 0) down += d;
      else up -= d;
    }
    if (Math.min(up, down) > 24) why.push(name + ' jumped (top ' + path.slice(0, 12).join(' > ') + ')');
    say(why.length ? 'bw-kb fail: ' + why.join('; ') : 'bw-kb ok');
  };
  var tick = function () {
    var f = follow;
    if (!f) return;
    if (document.activeElement !== f.el) {
      follow = null;
      return;
    }
    var top = Math.round(f.el.getBoundingClientRect().top);
    var last = f.tops[f.tops.length - 1];
    f.tops.push(top);
    var now = performance.now();
    if (Math.abs(top - last) > 1 || !keyboardUp()) f.still = now;
    if (now - f.still >= REST) f.rested = true;
    if (f.rested || now - f.start >= LIMIT) {
      follow = null;
      verdict(f);
      return;
    }
    f.timer = setTimeout(tick, STEP);
  };
  var start = function (el) {
    if (follow) clearTimeout(follow.timer);
    var now = performance.now();
    follow = { el: el, tops: [Math.round(el.getBoundingClientRect().top)], start: now, still: now, rested: false };
    say('bw-kb wait');
    follow.timer = setTimeout(tick, STEP);
  };
  // Focus starts following; the keyboard showing (or the view resizing)
  // after a verdict follows the same field again.
  document.addEventListener(
    'focusin',
    function (e) {
      if (isField(e.target)) start(e.target);
    },
    true,
  );
  var again = function () {
    var el = document.activeElement;
    if (isField(el) && !follow) start(el);
  };
  window.addEventListener('keyboardDidShow', again);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', again);

  // The App plugin proxy exists once the app module has registered it.
  var tries = 0;
  var timer = setInterval(function () {
    var cap = window.Capacitor;
    var App = cap && cap.Plugins && cap.Plugins.App;
    if (App && App.addListener) {
      clearInterval(timer);
      App.addListener('appUrlOpen', function (data) {
        apply(data && data.url);
      });
    } else if (++tries > 200) {
      clearInterval(timer);
    }
  }, 100);
})();
