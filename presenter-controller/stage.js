/* ES5 and XMLHttpRequest for older iOS / Android browsers. No dependencies. */
(function () {
  'use strict';
  var slides = [], current = -1, itemKey = null, state = null, liveMedia = false, previewSlideKey = null;
  var online = false, busy = false, loading = false, token = '', timer, failures = 0, unlock = false;
  var config = { lock_on_show_desktop: true, fetch_interval_ms: 800, allow_zoom: true, companion_ip: '10.0.0.155', companion_port: 8000, lock_on_companion_hold: true };
  var configReady = false, companionMode = null, companionUnavailable = false, companionFailures = 0;
  function el(id) { return document.getElementById(id); }
  function say(text) { el('message').textContent = text; el('message').hidden = !text; }
  function normalizeConfig(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) { throw new Error('config.json must contain an object.'); }
    var result = {}, key;
    for (key in config) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        result[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : config[key];
      }
    }
    var flags = ['lock_on_show_desktop', 'allow_zoom', 'lock_on_companion_hold'];
    for (var i = 0; i < flags.length; i++) {
      if (typeof result[flags[i]] !== 'boolean') { throw new Error(flags[i] + ' must be true or false.'); }
    }
    if (typeof result.fetch_interval_ms !== 'number' || result.fetch_interval_ms % 1 !== 0 || result.fetch_interval_ms < 100 || result.fetch_interval_ms > 60000) {
      throw new Error('fetch_interval_ms must be a whole number from 100 to 60000.');
    }
    if (typeof result.companion_port !== 'number' || result.companion_port % 1 !== 0 || result.companion_port < 1 || result.companion_port > 65535) {
      throw new Error('companion_port must be a whole number from 1 to 65535.');
    }
    if (typeof result.companion_ip !== 'string') { throw new Error('companion_ip must be a string.'); }
    result.companion_ip = result.companion_ip.replace(/^\s+|\s+$/g, '');
    var host = result.companion_ip;
    if (host && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) && !/^\[[0-9a-f:]+\]$/i.test(host) && !/^[0-9a-f]*:[0-9a-f:]*:[0-9a-f:]*$/i.test(host)) {
      throw new Error('companion_ip must be an IP address or hostname, without a URL or port.');
    }
    return result;
  }
  function loadConfig() {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error) {
      if (finished) { return; }
      finished = true;
      if (error) {
        el('config-warning').textContent = 'Config could not be loaded. Built-in settings are in use. ' + error;
        el('config-warning').hidden = false;
      }
      configReady = true;
      if (window.PresenterPreview) { window.PresenterPreview.setEnabled(config.allow_zoom); }
      controls(); updateCompanionStatus();
      if (config.lock_on_companion_hold) { pollCompanion(); }
      poll();
    }
    xhr.open('GET', '/stage/presenter-controller/config.json?_=' + Date.now(), true);
    xhr.timeout = 10000;
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) { finish('Check config.json in the stage folder.'); return; }
      try { config = normalizeConfig(JSON.parse(xhr.responseText)); } catch (error) { finish(error.message); return; }
      finish('');
    };
    xhr.onerror = xhr.ontimeout = function () { finish('Check the connection to OpenLP.'); };
    xhr.send(null);
  }
  function updateCompanionStatus() {
    el('companion-state').hidden = !config.lock_on_companion_hold;
    var mode = companionMode === 0 ? 'Hold' : (companionMode === 1 ? 'Ready' : (companionMode === 3 ? 'Wait' : 'Unknown'));
    el('companion-state').textContent = companionUnavailable ? 'Companion: unavailable' + (companionMode !== null ? ' · last mode: ' + mode : '') : 'Companion: ' + mode;
    el('companion-state').className = 'companion-state' + (companionUnavailable ? '' : ' ' + mode.toLowerCase());
  }
  function pollCompanion() {
    var xhr = new XMLHttpRequest(), finished = false;
    var host = config.companion_ip || window.location.hostname;
    if (host.indexOf(':') !== -1 && host.charAt(0) !== '[') { host = '[' + host + ']'; }
    function finish(error) {
      if (finished) { return; }
      finished = true;
      companionUnavailable = !!error;
      if (error) { companionFailures++; companionMode = null; }
      else {
        companionFailures = 0;
        var value = xhr.responseText.replace(/^\s+|\s+$/g, '');
        try { value = JSON.parse(value); } catch (ignore) { /* Companion also returns plain text. */ }
        companionMode = value === 0 || value === '0' ? 0 : (value === 1 || value === '1' ? 1 : (value === 3 || value === '3' ? 3 : null));
      }
      updateCompanionStatus(); controls();
      setTimeout(pollCompanion, companionFailures ? Math.max(config.fetch_interval_ms, Math.min(5000, companionFailures * 1000)) : config.fetch_interval_ms);
    }
    try {
      xhr.open('GET', 'http://' + host + ':' + config.companion_port + '/api/custom-variable/ready/value?_=' + Date.now(), true);
      xhr.timeout = 3000;
      /* No OpenLP token or custom headers: this is a simple cross-origin GET. */
      xhr.onload = function () { finish(xhr.status < 200 || xhr.status >= 300); };
      xhr.onerror = xhr.ontimeout = function () { finish(true); };
      xhr.send(null);
    } catch (error) { finish(true); }
  }
  function updateClock() {
    var now = new Date();
    el('datetime').setAttribute('datetime', now.toISOString());
    el('date').textContent = now.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    el('time').textContent = now.toLocaleTimeString();
  }
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  }
  function fullscreenHint(text) {
    el('fullscreen-help').textContent = text;
    el('fullscreen-help').hidden = !text;
  }
  function updateFullscreen() {
    var standalone = !!window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var active = !!fullscreenElement();
    el('fullscreen').textContent = standalone ? 'App mode' : (active ? 'Exit fullscreen' : 'Fullscreen');
    el('fullscreen').setAttribute('aria-pressed', active || standalone ? 'true' : 'false');
    el('fullscreen').disabled = !!standalone;
    if (active || standalone) { fullscreenHint(''); }
  }
  el('fullscreen').onclick = function () {
    var root = document.documentElement, active = !!fullscreenElement();
    var action = active ? (document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.mozCancelFullScreen || document.msExitFullscreen) :
      (root.requestFullscreen || root.webkitRequestFullscreen || root.webkitRequestFullScreen || root.mozRequestFullScreen || root.msRequestFullscreen);
    if (!action) {
      fullscreenHint('For fullscreen on an older iPad, open this page in Safari, tap Share, choose Add to Home Screen, then open Presenter Controller from the Home Screen.');
      return;
    }
    fullscreenHint('');
    try {
      var result = action.call(active ? document : root);
      if (result && result.then) { result.then(updateFullscreen, function () { fullscreenHint('Fullscreen could not open. On iPad, use Safari’s Share > Add to Home Screen, then open the saved app.'); }); }
    } catch (error) { fullscreenHint('Fullscreen is unavailable. On iPad, use Safari’s Share > Add to Home Screen, then open the saved app.'); }
  };
  var fullscreenEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
  for (var f = 0; f < fullscreenEvents.length; f++) { document.addEventListener(fullscreenEvents[f], updateFullscreen, false); }
  document.addEventListener('fullscreenerror', function () { fullscreenHint('Fullscreen is unavailable. On iPad, use Safari’s Share > Add to Home Screen, then open the saved app.'); }, false);
  function request(method, path, body, done) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error, data) { if (!finished) { finished = true; done(error, data); } }
    xhr.open(method, '/api/' + path, true);
    xhr.timeout = 10000;
    if (method === 'GET') { xhr.setRequestHeader('Cache-Control', 'no-cache'); }
    if (body) { xhr.setRequestHeader('Content-Type', 'application/json'); }
    if (token) { xhr.setRequestHeader('Authorization', token); }
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) { finish(xhr.status || -1); return; }
      var data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { finish(-2); return; }
      finish(null, data);
    };
    xhr.onerror = xhr.ontimeout = function () { finish(-1); };
    xhr.send(body ? JSON.stringify(body) : null);
  }
  function lockReason() {
    if (config.lock_on_companion_hold && companionMode === 0) { return 'The AV room now has control. Presenter controls are on Hold.'; }
    if (config.lock_on_show_desktop && state && state.display) { return 'The AV room now has control while the desktop is showing.'; }
    if (liveMedia) { return 'The AV room now has control while media is live.'; }
    return '';
  }
  function controls() {
    var reason = lockReason();
    el('control-lock').textContent = reason;
    el('control-lock').hidden = !reason;
    el('follow').disabled = false;
    el('login').hidden = !!reason || !(state && state.isSecure && !token);
    var disabled = !configReady || !!reason || !online || busy || loading || !!(state && state.isSecure && !token);
    el('previous').disabled = disabled || current <= 0;
    el('next').disabled = disabled || current < 0 || current >= slides.length - 1;
    el('blank').disabled = disabled || !state;
    var buttons = el('slides').getElementsByTagName('button');
    for (var i = 0; i < buttons.length; i++) { buttons[i].disabled = disabled; }
  }
  function connection(ok) {
    online = ok;
    el('connection').textContent = ok ? 'Connected' : 'Reconnecting…';
    el('connection').className = ok ? 'connected' : '';
    controls();
  }
  function imageSource(value) {
    if (typeof value !== 'string' || !value) { return ''; }
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(value)) { return value; }
    var link = document.createElement('a'); link.href = value;
    return link.host === window.location.host && link.protocol === window.location.protocol ? link.href : '';
  }
  function follow() {
    var row = el('slide-' + current), list = el('slides');
    if (!row) { return; }
    var r = row.getBoundingClientRect(), box = list.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) { list.scrollTop += r.top - box.top - (list.clientHeight - row.offsetHeight) / 2; }
  }
  function show(index, force) {
    var changed = index !== current;
    var slideKey = String(state && state.item) + ':' + index;
    if (slideKey !== previewSlideKey) {
      if (window.PresenterPreview) { window.PresenterPreview.reset(); }
      el('preview-text').scrollTop = 0;
      previewSlideKey = slideKey;
    }
    current = index;
    for (var i = 0; i < slides.length; i++) {
      var row = el('slide-' + i);
      row.className = 'slide' + (i === current ? ' current' : '');
      row.setAttribute('aria-current', i === current ? 'true' : 'false');
    }
    var slide = slides[current], src = slide ? imageSource(slide.img) : '';
    if (changed || force) {
      el('preview-image').hidden = !src;
      el('preview-text').hidden = !!src;
      el('preview-text').textContent = slide ? (slide.text || slide.title || 'No text preview available.') : 'No live slides. Send an item live in OpenLP.';
      if (src) { el('preview-image').src = src; } else { el('preview-image').removeAttribute('src'); }
      el('position').textContent = slide ? (current + 1) + ' / ' + slides.length : '—';
      follow();
    }
    controls();
  }
  el('preview-image').onerror = function () {
    this.hidden = true; el('preview-text').hidden = false;
  };
  function build(data) {
    /* OpenLP's RequiresMedia capability is 4. Playback state is not exposed,
       so keep the lock for the entire time a media item is live. */
    liveMedia = data.name === 'media' || (data.capabilities || []).indexOf(4) !== -1;
    slides = data.slides || [];
    el('title').textContent = data.title || 'No live item';
    var list = el('slides');
    while (list.firstChild) { list.removeChild(list.firstChild); }
    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i], row = document.createElement('button'), label = document.createElement('span');
      row.type = 'button'; row.id = 'slide-' + i; row.className = 'slide';
      row.setAttribute('data-index', i);
      row.setAttribute('aria-label', 'Show slide ' + (i + 1));
      label.className = 'slide-label'; label.textContent = (i + 1) + (slide.tag && String(slide.tag) !== String(i + 1) ? ' · ' + slide.tag : '');
      row.appendChild(label);
      var src = imageSource(slide.img), copy = document.createElement('span');
      copy.className = 'slide-copy'; copy.textContent = slide.text || slide.title || 'No preview';
      if (src) {
        var img = document.createElement('img'); img.alt = ''; img.src = src;
        copy.hidden = true;
        img.onerror = function () { this.hidden = true; this.nextSibling.hidden = false; };
        row.appendChild(img);
      }
      row.appendChild(copy);
      row.onclick = function () { command('controller/show', { id: parseInt(this.getAttribute('data-index'), 10) }); };
      list.appendChild(row);
    }
    if (!slides.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No live slides'; list.appendChild(empty); }
    var selected = -1;
    for (var j = 0; j < slides.length; j++) { if (slides[j].selected) { selected = j; break; } }
    show(selected >= 0 ? selected : (slides.length ? 0 : -1), true);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(poll, failures ? Math.max(config.fetch_interval_ms, Math.min(5000, failures * 1000)) : config.fetch_interval_ms); }
  function poll() {
    clearTimeout(timer);
    var unlockThisPoll = unlock;
    request('GET', 'poll', null, function (error, data) {
      if (error || !data || !data.results) { failures++; connection(false); schedule(); return; }
      state = data.results; failures = 0;
      if (unlockThisPoll) { busy = false; unlock = false; }
      el('login').hidden = !(state.isSecure && !token);
      el('blank').setAttribute('aria-pressed', state.blank ? 'true' : 'false');
      el('blank').textContent = state.blank ? 'Unblank screen' : 'Blank screen';
      el('display-state').textContent = state.blank ? 'Screen is blank · preview remains visible here' : (state.theme ? 'Showing theme only' : (state.display ? 'Showing desktop' : 'Screen is live'));
      el('display-state').className = 'display-state' + (state.blank ? ' blanked' : '');
      var key = String(state.item) + ':' + state.service + ':' + state.counter;
      if (key !== itemKey) {
        loading = true; connection(true);
        request('GET', 'v2/controller/live-items', null, function (err, live) {
          loading = false;
          if (err || !live) { failures++; connection(false); }
          else { itemKey = key; build(live); connection(true); }
          schedule();
        });
      } else { show(slides.length ? parseInt(state.slide, 10) : -1, false); connection(true); schedule(); }
    });
  }
  function command(path, body) {
    if (!configReady || lockReason() || !online || busy || loading || (state && state.isSecure && !token)) { return; }
    busy = true; controls(); say('');
    request('POST', 'v2/' + path, body, function (error) {
      if (error === 401 || error === 403) { token = ''; el('login').hidden = false; say('Sign in with your OpenLP remote credentials.'); }
      else if (error) { say('Command could not be confirmed. Check OpenLP before trying again.'); }
      /* Do not retry control commands: a timeout may have happened after execution. */
      unlock = true;
    });
  }
  el('previous').onclick = function () { if (current > 0) { command('controller/progress', { action: 'previous' }); } };
  el('next').onclick = function () { if (current < slides.length - 1) { command('controller/progress', { action: 'next' }); } };
  el('blank').onclick = function () { if (state) { command('core/display', { display: state.blank ? 'show' : 'blank' }); } };
  el('follow').onclick = follow;
  el('login').onsubmit = function (event) {
    event.preventDefault();
    if (lockReason()) { return; }
    request('POST', 'v2/core/login', { username: el('username').value, password: el('password').value }, function (error, data) {
      el('password').value = '';
      if (error || !data || !data.token) { say('Sign-in failed. Check your credentials and connection.'); return; }
      token = data.token; el('login').hidden = true; say(''); controls();
    });
  };
  window.addEventListener('resize', follow, false);
  updateClock();
  setInterval(updateClock, 1000);
  updateFullscreen();
  if (window.PresenterPreview) { window.PresenterPreview.setEnabled(false); }
  loadConfig();
}());
