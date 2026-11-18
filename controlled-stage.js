/* Shared source for the four Companion-controlled OpenLP stage views.
 * The deploy script copies this file to each view as stage.js. */
(function () {
  'use strict';

  var HOLD_MS = 10000;
  var config = {
    screen_id: 'banner', screen_name: 'Banner', service_name: '',
    companion_ip: '10.0.0.155', companion_port: 8000,
    poll_interval_ms: 300, openlp_fallback_poll_ms: 200, pyssp_fallback_poll_ms: 200,
    sources: [{ id: 0, type: 'openlp', host: '', port: 4316 }]
  };
  var layout = '';
  var mode = 'lyrics';
  var sourceId = 0;
  var lastData = null;
  var sourceDisconnectedAt = null;
  var sourceGeneration = 0;
  var sourceEpoch = 0;
  var sourceFailures = 0;
  var sourceCache = null;
  var sourceSocket = null;
  var socketReconnectTimer = null;
  var socketFailures = 0;
  var sourcePollInFlight = false;
  var latestSocketInfo = null;
  var liveRequestKey = null;
  var sourceTimer = null;
  var expiryTimer = null;
  var companionFailures = 0;
  var refreshToken = null;
  var hasRefreshToken = false;
  var bannerFontMax = Infinity;
  var bannerLayer = 'A';
  var bannerText = null;
  var overlayLayer = 'A';
  var overlayText = null;
  var overheadKey = null;

  function byId(id) { return document.getElementById(id); }
  function trim(value) { return String(value == null ? '' : value).replace(/^\s+|\s+$/g, ''); }
  function integer(value, min, max) { return typeof value === 'number' && value % 1 === 0 && value >= min && value <= max; }
  function validHost(host) {
    return host === '' || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || /^\[[0-9a-f:]+\]$/i.test(host);
  }
  function hostForUrl(host) {
    host = host || window.location.hostname;
    return host.indexOf(':') >= 0 && host.charAt(0) !== '[' ? '[' + host + ']' : host;
  }
  function sourceById(id) {
    for (var i = 0; i < config.sources.length; i++) {
      if (config.sources[i].id === id) { return config.sources[i]; }
    }
    return null;
  }
  function normaliseConfig(raw) {
    if (!raw || typeof raw !== 'object' || Object.prototype.toString.call(raw) !== '[object Object]') { throw new Error('config.json must be an object'); }
    var result = {};
    result.screen_id = trim(raw.screen_id || config.screen_id);
    result.screen_name = trim(raw.screen_name || config.screen_name);
    result.service_name = trim(raw.service_name || '');
    result.companion_ip = trim(raw.companion_ip == null ? config.companion_ip : raw.companion_ip);
    result.companion_port = raw.companion_port == null ? config.companion_port : raw.companion_port;
    result.poll_interval_ms = raw.poll_interval_ms == null ? config.poll_interval_ms : raw.poll_interval_ms;
    result.openlp_fallback_poll_ms = raw.openlp_fallback_poll_ms == null ? config.openlp_fallback_poll_ms : raw.openlp_fallback_poll_ms;
    result.pyssp_fallback_poll_ms = raw.pyssp_fallback_poll_ms == null ? config.pyssp_fallback_poll_ms : raw.pyssp_fallback_poll_ms;
    result.sources = raw.sources == null ? config.sources : raw.sources;
    if (!/^[a-z][a-z0-9_]*$/.test(result.screen_id)) { throw new Error('screen_id must contain letters, digits or underscores'); }
    if (!result.screen_name) { throw new Error('screen_name is required'); }
    if (!validHost(result.companion_ip) || !integer(result.companion_port, 1, 65535)) { throw new Error('invalid Companion host or port'); }
    if (!integer(result.poll_interval_ms, 200, 60000)) { throw new Error('poll_interval_ms must be 200 to 60000'); }
    if (!integer(result.openlp_fallback_poll_ms, 100, 60000)) { throw new Error('openlp_fallback_poll_ms must be 100 to 60000'); }
    if (!integer(result.pyssp_fallback_poll_ms, 100, 60000)) { throw new Error('pyssp_fallback_poll_ms must be 100 to 60000'); }
    if (!Array.isArray(result.sources) || !result.sources.length) { throw new Error('sources must be a nonempty array'); }
    var seen = {};
    result.sources = result.sources.map(function (source) {
      if (!source || !integer(source.id, 0, 999999) || (source.type !== 'openlp' && source.type !== 'pyssp')) { throw new Error('invalid source id or type'); }
      if (seen[source.id]) { throw new Error('duplicate source id ' + source.id); }
      seen[source.id] = true;
      var host = trim(source.host || '');
      if (!validHost(host) || (source.id !== 0 && !host)) { throw new Error('invalid source host for id ' + source.id); }
      if (!integer(source.port, 1, 65535)) { throw new Error('invalid source port for id ' + source.id); }
      var wsPort = source.ws_port == null ? source.port + 1 : source.ws_port;
      if (!integer(wsPort, 1, 65535)) { throw new Error('invalid WebSocket port for id ' + source.id); }
      return { id: source.id, type: source.type, host: host, port: source.port, ws_port: wsPort };
    });
    if (!seen[0] || sourceByType(result.sources, 0) !== 'openlp') { throw new Error('source 0 must be the original OpenLP machine'); }
    return result;
  }
  function sourceByType(sources, id) {
    for (var i = 0; i < sources.length; i++) { if (sources[i].id === id) { return sources[i].type; } }
    return '';
  }
  function requestText(url, done) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(error, value) { if (!finished) { finished = true; done(error, value); } }
    try {
      xhr.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now(), true);
      xhr.timeout = 2500;
      xhr.onload = function () { finish(xhr.status < 200 || xhr.status >= 300, xhr.responseText); };
      xhr.onerror = xhr.ontimeout = function () { finish(true, ''); };
      xhr.send(null);
    } catch (error) { finish(true, ''); }
  }
  function requestJson(url, done) {
    requestText(url, function (error, text) {
      if (error) { done(true, null); return; }
      try { done(false, JSON.parse(text)); } catch (ignore) { done(true, null); }
    });
  }
  function baseUrl(host, port) { return 'http://' + hostForUrl(host) + ':' + port; }
  function companionUrl(name) {
    return baseUrl(config.companion_ip, config.companion_port) + '/api/custom-variable/' + encodeURIComponent(name) + '/value';
  }
  function parseCompanionValue(text) {
    text = trim(text);
    try { return JSON.parse(text); } catch (ignore) { return text; }
  }
  function pollCompanion() {
    var prefix = 'stage_' + config.screen_id + '_';
    var names = [prefix + 'mode', prefix + 'source', 'stage_force_refresh'];
    var remaining = names.length;
    var failures = 0;
    function completed() {
      remaining--;
      if (remaining) { return; }
      companionFailures = failures === names.length ? companionFailures + 1 : 0;
      document.body.setAttribute('data-companion-status', failures === names.length ? 'disconnected' : 'connected');
      setTimeout(pollCompanion, companionFailures ? Math.min(3000, companionFailures * 1000) : config.poll_interval_ms);
    }
    function receive(name, error, text) {
      if (error) { failures++; completed(); return; }
      var value = parseCompanionValue(text);
      if (name === prefix + 'mode') {
        value = trim(value).toLowerCase();
        if ((value === 'lyrics' || value === 'title' || value === 'blank') && value !== mode) {
          mode = value;
          render();
        }
      } else if (name === prefix + 'source') {
        var parsed = Number(value);
        if (integer(parsed, 0, 999999) && parsed !== sourceId) { selectSource(parsed); }
      } else if (name === 'stage_force_refresh') {
        value = String(value);
        if (hasRefreshToken && value !== refreshToken) {
          refreshToken = value;
          window.location.reload();
          return;
        }
        refreshToken = value;
        hasRefreshToken = true;
      }
      completed();
    }
    for (var i = 0; i < names.length; i++) {
      (function (name) { requestText(companionUrl(name), function (error, text) { receive(name, error, text); }); })(names[i]);
    }
  }
  function selectSource(id) {
    sourceId = id;
    sourceGeneration++;
    closeSourceSocket();
    sourceFailures = 0;
    socketFailures = 0;
    sourceCache = null;
    latestSocketInfo = null;
    liveRequestKey = null;
    sourcePollInFlight = false;
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    sourceDisconnectedAt = null;
    markDisconnected();
    if (sourceById(id)) { connectSourceSocket(sourceGeneration); }
    pollSource(sourceGeneration);
  }
  function closeSourceSocket() {
    if (socketReconnectTimer) { clearTimeout(socketReconnectTimer); socketReconnectTimer = null; }
    if (sourceSocket) {
      var socket = sourceSocket;
      sourceSocket = null;
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch (ignore) { /* Already closed. */ }
    }
  }
  function retrySourceSocket(generation) {
    if (generation !== sourceGeneration || socketReconnectTimer) { return; }
    socketFailures++;
    socketReconnectTimer = setTimeout(function () {
      socketReconnectTimer = null;
      connectSourceSocket(generation);
    }, Math.min(3000, socketFailures * 500));
  }
  function connectSourceSocket(generation) {
    if (generation !== sourceGeneration || sourceSocket || typeof WebSocket === 'undefined') { return; }
    var source = sourceById(sourceId);
    if (!source) { return; }
    var socket;
    try { socket = new WebSocket('ws://' + hostForUrl(source.host) + ':' + source.ws_port); }
    catch (error) { retrySourceSocket(generation); return; }
    sourceSocket = socket;
    socket.onopen = function () { if (generation === sourceGeneration) { socketFailures = 0; } };
    socket.onmessage = function (event) {
      if (generation !== sourceGeneration || sourceSocket !== socket) { return; }
      function read(text) {
        if (generation !== sourceGeneration || sourceSocket !== socket) { return; }
        try {
          var message = JSON.parse(text);
          if (message && message.results) { acceptSocketInfo(source, message.results, generation); }
        } catch (ignore) { /* Ignore malformed updates; HTTP polling remains available. */ }
      }
      if (typeof event.data === 'string') { read(event.data); }
      else if (typeof FileReader !== 'undefined') {
        try {
          var reader = new FileReader();
          reader.onload = function () { read(String(reader.result || '')); };
          reader.readAsText(event.data);
        } catch (ignore) { /* HTTP fallback handles unsupported message types. */ }
      }
    };
    socket.onerror = function () { try { socket.close(); } catch (ignore) { /* onclose will retry. */ } };
    socket.onclose = function () {
      if (generation !== sourceGeneration || sourceSocket !== socket) { return; }
      sourceSocket = null;
      markDisconnected();
      retrySourceSocket(generation);
      if (!sourcePollInFlight) {
        if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
        pollSource(generation);
      }
    };
  }
  function markDisconnected() {
    if (sourceDisconnectedAt === null) { sourceDisconnectedAt = Date.now(); }
    sourceEpoch++;
    sourceCache = null;
    latestSocketInfo = null;
    document.body.setAttribute('data-source-status', 'disconnected');
    if (expiryTimer) { clearTimeout(expiryTimer); }
    var remaining = Math.max(0, HOLD_MS - (Date.now() - sourceDisconnectedAt));
    if (remaining) { expiryTimer = setTimeout(render, remaining + 5); }
    render();
  }
  function scheduleSource(generation, failed) {
    if (generation !== sourceGeneration) { return; }
    sourceFailures = failed ? sourceFailures + 1 : 0;
    var source = sourceById(sourceId);
    var interval = config.poll_interval_ms;
    if (source) { interval = sourceSocket && sourceSocket.readyState === 1 ? 2000 :
      (source.type === 'openlp' ? config.openlp_fallback_poll_ms : config.pyssp_fallback_poll_ms); }
    if (failed) { interval = Math.min(3000, sourceFailures * 1000); }
    sourceTimer = setTimeout(function () { pollSource(generation); }, interval);
  }
  function commitSource(normalised) {
    if (!normalised) { markDisconnected(); return; }
    lastData = normalised;
    sourceDisconnectedAt = null;
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    document.body.setAttribute('data-source-status', 'connected');
    render();
  }
  function sourceKey(source, info) {
    return String(info && info.item || '') + (source.type === 'openlp' ? ':' + String(info && info.service || '') : '');
  }
  function acceptSocketInfo(source, info, generation) {
    if (generation !== sourceGeneration || !info || typeof info !== 'object') { return; }
    var key = sourceKey(source, info);
    if (source.type === 'openlp' && latestSocketInfo && sourceKey(source, latestSocketInfo) === key &&
        Number(info.counter) < Number(latestSocketInfo.counter)) { return; }
    latestSocketInfo = info;
    if (sourceCache && sourceCache.key === key) {
      commitSource(normaliseSource(source, { results: info }, sourceCache.live));
      return;
    }
    if (liveRequestKey !== null) { return; }
    liveRequestKey = key;
    var requestEpoch = sourceEpoch;
    requestJson(baseUrl(source.host, source.port) + '/api/v2/controller/live-items', function (error, live) {
      if (generation !== sourceGeneration) { return; }
      liveRequestKey = null;
      if (requestEpoch !== sourceEpoch) {
        if (latestSocketInfo) { acceptSocketInfo(source, latestSocketInfo, generation); }
        return;
      }
      if (!latestSocketInfo) { return; }
      if (key !== sourceKey(source, latestSocketInfo)) {
        acceptSocketInfo(source, latestSocketInfo, generation);
        return;
      }
      if (error || !live || !Array.isArray(live.slides)) { markDisconnected(); return; }
      sourceCache = { key: key, live: live };
      commitSource(normaliseSource(source, { results: latestSocketInfo }, live));
    });
  }
  function pollSource(generation) {
    if (generation !== sourceGeneration || sourcePollInFlight) { return; }
    var source = sourceById(sourceId);
    if (!source) { markDisconnected(); scheduleSource(generation, true); return; }
    var base = baseUrl(source.host, source.port);
    sourcePollInFlight = true;
    if (source.type === 'openlp') {
      requestJson(base + '/api/poll', function (error, status) {
        if (generation !== sourceGeneration) { return; }
        sourcePollInFlight = false;
        if (error || !status || !status.results) { markDisconnected(); scheduleSource(generation, true); return; }
        acceptSocketInfo(source, status.results, generation);
        scheduleSource(generation, false);
      });
    } else {
      var results = {}, remaining = 2, failed = false;
      function received(which, error, data) {
        if (generation !== sourceGeneration) { return; }
        if (error) { failed = true; } else { results[which] = data; }
        remaining--;
        if (!remaining) {
          sourcePollInFlight = false;
          var live = results.live;
          if (!failed && live && Array.isArray(live.slides)) {
            sourceCache = { key: String(live.item || ''), live: live };
          }
          var status = results.status;
          if (latestSocketInfo && sourceCache && sourceCache.key === sourceKey(source, latestSocketInfo)) {
            status = { results: latestSocketInfo };
          }
          var normalised = failed ? null : normaliseSource(source, status, live);
          if (normalised) { commitSource(normalised); } else { markDisconnected(); }
          scheduleSource(generation, !normalised);
        }
      }
      requestJson(base + '/api/health', function (error, data) { received('status', error, data); });
      requestJson(base + '/api/v2/controller/live-items', function (error, data) { received('live', error, data); });
    }
  }
  function normaliseSource(source, status, live) {
    if (!live || !Array.isArray(live.slides)) { return null; }
    var info = status && (status.results || (status.result && status.result.state));
    if (!info || typeof info !== 'object') { return null; }
    var slides = live.slides;
    var index = info.slide == null ? -1 : Number(info.slide);
    if (!integer(index, 0, slides.length - 1)) {
      index = -1;
      for (var i = 0; i < slides.length; i++) { if (slides[i] && slides[i].selected) { index = i; break; } }
    }
    if (!integer(index, 0, slides.length - 1)) { index = slides.length ? 0 : -1; }
    var title = trim(live.title || (index >= 0 && slides[index] && slides[index].title) || '');
    var sourceBlank = source.type === 'openlp' ?
      (info.blank === true || info.theme === true) : (info.blank === true || info.lyric_display === 'blank');
    return {
      slides: slides, index: index, title: title, blank: sourceBlank,
      itemKey: String(info.item || live.item || '') + ':' + String(info.service || ''),
      base: baseUrl(source.host, source.port)
    };
  }
  function currentData() {
    if (!lastData) { return null; }
    if (sourceDisconnectedAt !== null && Date.now() - sourceDisconnectedAt >= HOLD_MS) { return null; }
    return lastData;
  }
  function serviceTitle(data) { return config.service_name || data.title || ''; }
  function slideText(slide) {
    if (!slide) { return ''; }
    var raw = trim(slide.text || '');
    if (trim(slide.img || '') || /<img\b/i.test(slide.html || '') || /<img\b/i.test(raw)) { return ''; }
    return raw.replace(/\r/g, '');
  }
  function render() {
    var data = currentData();
    var effectiveMode = mode === 'blank' || !data ? 'blank' : mode;
    document.body.className = 'stage-' + effectiveMode;
    if (effectiveMode === 'title') { byId('title-card').textContent = serviceTitle(data); }
    if (effectiveMode === 'lyrics') {
      if (layout === 'banner') { renderBanner(data); }
      else if (layout === 'overhead') { renderOverhead(data); }
      else { renderOverlay(data); }
    }
  }
  function renderBanner(data) {
    var text = data.blank ? '' : slideText(data.slides[data.index]);
    var lines = text.split('\n').map(trim).filter(function (line) { return !!line; });
    text = lines.slice(0, 2).join('\n');
    if (data.itemKey !== renderBanner.itemKey) { bannerFontMax = Infinity; renderBanner.itemKey = data.itemKey; }
    if (text === bannerText) { return; }
    bannerText = text;
    var incoming = byId(bannerLayer === 'A' ? 'banner-layerB' : 'banner-layerA');
    var outgoing = byId(bannerLayer === 'A' ? 'banner-layerA' : 'banner-layerB');
    var size = fitBanner(text);
    if (text) { bannerFontMax = Math.min(bannerFontMax, size); }
    incoming.style.fontSize = (text ? bannerFontMax : size) + 'px';
    incoming.textContent = text;
    incoming.style.opacity = '0';
    void incoming.offsetHeight;
    outgoing.style.opacity = '0';
    incoming.style.opacity = '1';
    bannerLayer = bannerLayer === 'A' ? 'B' : 'A';
  }
  function fitBanner(text) {
    var measure = byId('text-measure');
    var container = byId('banner-container');
    var styles = window.getComputedStyle(document.documentElement);
    var horizontal = parseFloat(styles.getPropertyValue('--horizontal-padding')) || 0;
    var vertical = parseFloat(styles.getPropertyValue('--vertical-padding')) || 0;
    var width = Math.max(1, container.clientWidth - horizontal * 2);
    var height = Math.max(1, container.clientHeight - vertical * 2);
    var size = Math.max(32, height);
    measure.style.maxWidth = width + 'px';
    measure.style.fontSize = size + 'px';
    measure.textContent = text;
    while (size > 32 && (measure.scrollWidth > width || measure.scrollHeight > height)) {
      size -= 2;
      measure.style.fontSize = size + 'px';
    }
    return size;
  }
  function safeImage(src, base) {
    src = trim(src);
    if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) { return src; }
    if (!src) { return ''; }
    var anchor = document.createElement('a');
    anchor.href = base + '/';
    var expectedHost = anchor.host;
    anchor.href = src.charAt(0) === '/' ? base + src : (src.indexOf('http:') === 0 || src.indexOf('https:') === 0 ? src : base + '/' + src);
    return (anchor.protocol === 'http:' || anchor.protocol === 'https:') && anchor.host === expectedHost ? anchor.href : '';
  }
  function renderOverhead(data) {
    var slide = data.slides[data.index];
    var image = data.blank || !slide ? '' : safeImage(slide.img, data.base);
    var key = data.itemKey + ':' + data.index + ':' + data.blank + ':' + serviceTitle(data) + ':' + image;
    for (var k = data.index; k < data.slides.length && k < data.index + 5; k++) { key += ':' + slideText(data.slides[k]); }
    if (key === overheadKey) { return; }
    overheadKey = key;
    var lines = byId('lines');
    while (lines.firstChild) { lines.removeChild(lines.firstChild); }
    byId('caption-container').className = image ? 'image-mode' : '';
    if (image) {
      var row = document.createElement('div'); row.className = 'line line-current';
      var img = document.createElement('img'); img.className = 'caption-image'; img.src = image;
      row.appendChild(img); lines.appendChild(row);
    } else if (!data.blank) {
      var collected = [];
      for (var i = data.index; i < data.slides.length && collected.length < 4; i++) {
        var value = slideText(data.slides[i]);
        if (value) { collected.push({ text: value, current: i === data.index }); }
      }
      for (var j = 0; j < collected.length; j++) {
        var line = document.createElement('div');
        line.className = 'line' + (collected[j].current ? ' line-current' : '');
        line.textContent = collected[j].text;
        lines.appendChild(line);
      }
    }
    byId('song-title').textContent = data.blank ? '' : data.title;
  }
  function renderOverlay(data) {
    var text = data.blank ? '' : slideText(data.slides[data.index]);
    if (layout === 'vmixcenter') { text = trim(text.replace(/\s+/g, ' ')); }
    if (text === overlayText) { return; }
    overlayText = text;
    var incoming = byId(overlayLayer === 'A' ? 'lyricB' : 'lyricA');
    var outgoing = byId(overlayLayer === 'A' ? 'lyricA' : 'lyricB');
    incoming.textContent = text;
    incoming.style.fontSize = '';
    if (layout === 'vmixcenter' && text) { fitCenter(incoming); }
    incoming.style.opacity = '0';
    void incoming.offsetHeight;
    outgoing.style.opacity = '0';
    incoming.style.opacity = '1';
    overlayLayer = overlayLayer === 'A' ? 'B' : 'A';
  }
  function fitCenter(element) {
    var size = parseFloat(window.getComputedStyle(element).fontSize) || 64;
    var width = element.clientWidth;
    for (var i = 0; i < 5 && element.scrollWidth > width && width > 0; i++) {
      size = Math.max(32, size * width / element.scrollWidth - 0.25);
      element.style.fontSize = size + 'px';
    }
  }
  function loadConfig() {
    requestJson('config.json', function (error, raw) {
      if (!error) {
        try { config = normaliseConfig(raw); } catch (invalid) { console.warn('Controlled stage config:', invalid.message); }
      } else { console.warn('Controlled stage config.json could not be loaded; using defaults'); }
      document.title = config.screen_name;
      document.body.setAttribute('data-screen-name', config.screen_name);
      document.body.setAttribute('data-companion-status', 'connecting');
      pollCompanion();
      selectSource(sourceId);
    });
  }
  function init() {
    layout = document.body.getAttribute('data-layout') || 'banner';
    config.screen_id = layout.toLowerCase();
    config.screen_name = document.title;
    window.addEventListener('resize', function () {
      if (layout === 'banner') { bannerText = null; }
      else if (layout === 'vmixcenter') { overlayText = null; }
      render();
    });
    loadConfig();
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
}());
