/* ES5 and XMLHttpRequest for older iOS / Android browsers. No dependencies. */
(function () {
  'use strict';
  var slides = [], current = -1, itemKey = null, state = null, liveMedia = false;
  var online = false, busy = false, loading = false, token = '', timer, failures = 0, unlock = false;
  function el(id) { return document.getElementById(id); }
  function say(text) { el('message').textContent = text; el('message').hidden = !text; }
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
    if (state && state.display) { return 'The AV room now has control while the desktop is showing. Presentation controls will resume automatically when the AV room returns to text or slides.'; }
    if (liveMedia) { return 'The AV room now has control while media is live. Presentation controls will resume automatically when the AV room returns to text or slides.'; }
    return '';
  }
  function controls() {
    var reason = lockReason();
    el('control-lock').textContent = reason;
    el('control-lock').hidden = !reason;
    el('follow').disabled = !!reason;
    el('login').hidden = !!reason || !(state && state.isSecure && !token);
    var disabled = !!reason || !online || busy || loading || !!(state && state.isSecure && !token);
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
  function schedule() { clearTimeout(timer); timer = setTimeout(poll, failures ? Math.min(5000, failures * 1000) : 800); }
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
    if (lockReason() || !online || busy || loading || (state && state.isSecure && !token)) { return; }
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
  el('follow').onclick = function () { if (!lockReason()) { follow(); } };
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
  poll();
}());
