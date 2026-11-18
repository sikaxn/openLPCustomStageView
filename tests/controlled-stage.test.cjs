const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'controlled-stage.js'), 'utf8');

function browser(layout = 'banner', options = {}) {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const requests = [];
  const values = {
    stage_banner_mode: 'lyrics', stage_banner_source: '0',
    stage_overhead_mode: 'lyrics', stage_overhead_source: '0',
    stage_vmixoverlay_mode: 'lyrics', stage_vmixoverlay_source: '0',
    stage_vmixcenter_mode: 'lyrics', stage_vmixcenter_source: '0',
    stage_force_refresh: '0',
  };
  const online = { companion: true, openlp: true, remote: true, pyssp: true };
  const sockets = [];
  const pollStates = {
    openlp: { item: 'openlp', service: 1, slide: 0, counter: 1, blank: false, theme: false, display: false },
    remote: { item: 'remote', service: 1, slide: 0, counter: 1, blank: false, theme: false, display: false },
    pyssp: { item: 'pyssp', service: 'pyssp|song', slide: 0, blank: false, theme: false, display: 'show' },
  };
  const config = {
    screen_id: layout.toLowerCase(), screen_name: layout, service_name: '',
    companion_ip: '10.0.0.155', companion_port: 8000, poll_interval_ms: 300,
    sources: [
      { id: 0, type: 'openlp', host: '', port: 4316 },
      { id: 1, type: 'pyssp', host: '10.0.0.155', port: 5050 },
      { id: 2, type: 'openlp', host: '10.0.0.156', port: 4316 },
    ],
  };
  const slides = {
    openlp: options.openlpSlides || [{ selected: true, text: 'Original lyric', title: 'Original item', img: '' }],
    remote: [{ selected: true, text: 'Remote lyric', title: 'Remote item', img: '' }],
    pyssp: options.pysspSlides || [{ selected: true, text: 'pySSP lyric', title: 'pySSP item', img: '' }],
  };

  class Element {
    constructor(id = '') {
      this.id = id;
      this.style = {};
      this.children = [];
      this.attributes = {};
      this.className = '';
      this.textContent = '';
      this.clientWidth = 1000;
      this.clientHeight = 192;
      this.scrollWidth = 100;
      this.scrollHeight = 100;
      this.offsetHeight = 100;
    }
    get firstChild() { return this.children[0] || null; }
    getAttribute(key) { return this.attributes[key] || null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  }
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  }
  const body = element('body');
  body.setAttribute('data-layout', layout);
  const document = {
    body, title: layout, readyState: 'complete', documentElement: element('root'),
    getElementById: element,
    createElement(tag) {
      if (tag === 'a') {
        let url = new URL('http://10.0.0.155:4316/');
        return {
          set href(value) { url = new URL(value, url); }, get href() { return url.href; },
          get host() { return url.host; }, get protocol() { return url.protocol; },
        };
      }
      return new Element(tag);
    },
  };
  const window = {
    location: { hostname: '10.0.0.155', reload() { window.reloads++; } },
    reloads: 0,
    addEventListener() {},
    getComputedStyle() { return { fontSize: '64px', getPropertyValue(name) { return name === '--horizontal-padding' ? '150px' : '8px'; } }; },
  };
  function setTimeoutFake(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { time: now + delay, callback });
    return id;
  }
  function advance(ms) {
    const end = now + ms;
    let steps = 0;
    while (true) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.time <= end && (!next || timer.time < next.time)) next = { id, ...timer };
      }
      if (!next) break;
      if (++steps > 10000) throw new Error('timer loop');
      now = next.time;
      timers.delete(next.id);
      next.callback();
    }
    now = end;
  }
  function response(url) {
    const parsed = new URL(url, 'http://10.0.0.155:4316/stage/banner-controlled/');
    requests.push({ host: parsed.hostname, port: parsed.port, path: parsed.pathname });
    if (parsed.pathname.endsWith('/config.json')) return config;
    if (parsed.port === '8000') {
      if (!online.companion) throw new Error('Companion offline');
      const name = parsed.pathname.split('/')[3];
      return values[name];
    }
    const type = parsed.port === '5050' ? 'pyssp' : (parsed.hostname === '10.0.0.156' ? 'remote' : 'openlp');
    if (!online[type]) throw new Error(type + ' offline');
    if (parsed.pathname === '/api/poll') {
      return { results: pollStates[type] };
    }
    if (parsed.pathname === '/api/health') return { result: { state: { lyric_display: 'show' } } };
    if (parsed.pathname === '/api/v2/controller/live-items') {
      return { item: pollStates[type] && pollStates[type].item || type, title: slides[type][0].title, slides: slides[type] };
    }
    throw new Error('Unexpected request ' + parsed.pathname);
  }
  class XMLHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      try {
        const value = response(this.url);
        this.status = 200;
        this.responseText = typeof value === 'string' ? value : JSON.stringify(value);
        if (options.liveDelayMs && this.url.includes('/api/v2/controller/live-items')) {
          setTimeoutFake(() => this.onload(), options.liveDelayMs);
        } else {
          this.onload();
        }
      } catch (_error) {
        this.status = 0;
        this.onerror();
      }
    }
  }
  class WebSocket {
    constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); }
    emit(results, binary = false) {
      if (this.onmessage) {
        const text = JSON.stringify({ results });
        this.onmessage({ data: binary ? { text } : text });
      }
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }
  class FileReader {
    readAsText(blob) { this.result = blob.text; this.onload(); }
  }
  class FakeDate extends Date { static now() { return now; } }
  const globals = {
    document, window, XMLHttpRequest, Date: FakeDate,
    setTimeout: setTimeoutFake, clearTimeout(id) { timers.delete(id); },
    console: { warn() {} },
  };
  if (options.websocket) {
    globals.WebSocket = WebSocket;
    globals.FileReader = FileReader;
  }
  vm.runInNewContext(script, globals);
  return { body, element, values, online, requests, slides, sockets, pollStates, window, advance };
}

test('remote OpenLP reconnects and the ten-second hold expires', () => {
  const app = browser();
  assert.equal(app.body.className, 'stage-lyrics');
  assert.equal(app.element('banner-layerB').textContent, 'Original lyric');

  app.values.stage_banner_source = '2';
  app.advance(800);
  assert.equal(app.body.className, 'stage-lyrics');
  assert.equal(app.element('banner-layerA').textContent, 'Remote lyric');
  assert.ok(app.requests.some(r => r.host === '10.0.0.156' && r.port === '4316'));

  app.online.remote = false;
  app.advance(800);
  assert.equal(app.body.className, 'stage-lyrics');
  app.advance(10010);
  assert.equal(app.body.className, 'stage-blank');

  app.online.remote = true;
  app.advance(3000);
  assert.equal(app.body.className, 'stage-lyrics');
  assert.equal(app.body.getAttribute('data-source-status'), 'connected');
});

test('Companion loss retains title mode; source 1 uses pySSP IP and port', () => {
  const app = browser('vmixOverlay');
  app.values.stage_vmixoverlay_mode = 'title';
  app.advance(800);
  assert.equal(app.body.className, 'stage-title');
  assert.equal(app.element('title-card').textContent, 'Original item');

  app.online.companion = false;
  app.advance(3000);
  assert.equal(app.body.className, 'stage-title');
  assert.equal(app.body.getAttribute('data-companion-status'), 'disconnected');

  app.online.companion = true;
  app.values.stage_vmixoverlay_source = '1';
  app.advance(3000);
  assert.equal(app.body.className, 'stage-title');
  assert.equal(app.element('title-card').textContent, 'pySSP item');
  assert.ok(app.requests.some(r => r.host === '10.0.0.155' && r.port === '5050' && r.path === '/api/v2/controller/live-items'));
});

test('changing the shared force-refresh variable reloads the page once', () => {
  const app = browser('overhead');
  assert.equal(app.window.reloads, 0);
  app.values.stage_force_refresh = '1';
  app.advance(800);
  assert.equal(app.window.reloads, 1);
});

test('OpenLP WebSocket shows the next cached slide immediately without fetching live-items again', () => {
  const app = browser('banner', {
    websocket: true,
    openlpSlides: [
      { selected: true, text: 'First lyric', title: 'First item', img: '' },
      { selected: false, text: 'Second lyric', title: 'First item', img: '' },
    ],
  });
  const liveRequests = () => app.requests.filter(r => r.path === '/api/v2/controller/live-items');
  assert.equal(liveRequests().length, 1);
  assert.equal(app.sockets[0].url, 'ws://10.0.0.155:4317');
  app.pollStates.openlp.slide = 1;
  app.pollStates.openlp.counter = 2;
  app.sockets[0].emit(app.pollStates.openlp, true);
  assert.equal(app.element('banner-layerA').textContent, 'Second lyric');
  assert.equal(liveRequests().length, 1);
  app.pollStates.openlp.display = true;
  app.pollStates.openlp.counter = 3;
  app.sockets[0].emit(app.pollStates.openlp);
  assert.equal(app.element('banner-layerA').textContent, 'Second lyric');
  app.pollStates.openlp.display = 'desktop';
  app.pollStates.openlp.counter = 4;
  app.sockets[0].emit(app.pollStates.openlp);
  assert.equal(app.element('banner-layerA').textContent, 'Second lyric');
  app.pollStates.openlp.blank = true;
  app.pollStates.openlp.counter = 5;
  app.sockets[0].emit(app.pollStates.openlp);
  assert.equal(app.element('banner-layerB').textContent, '');
  app.advance(2000);
  assert.equal(liveRequests().length, 1);
});

test('OpenLP WebSocket reconnects and HTTP polling accepts a restarted counter', () => {
  const app = browser('banner', {
    websocket: true,
    openlpSlides: [
      { selected: true, text: 'First lyric', title: 'First item', img: '' },
      { selected: false, text: 'Second lyric', title: 'First item', img: '' },
    ],
  });
  app.pollStates.openlp.slide = 1;
  app.pollStates.openlp.counter = 10;
  app.sockets[0].emit(app.pollStates.openlp);
  assert.equal(app.element('banner-layerA').textContent, 'Second lyric');
  app.online.openlp = false;
  app.sockets[0].close();
  assert.equal(app.body.getAttribute('data-source-status'), 'disconnected');
  app.online.openlp = true;
  app.pollStates.openlp.slide = 0;
  app.pollStates.openlp.counter = 1;
  app.advance(500);
  assert.equal(app.sockets.length, 2);
  app.advance(1000);
  assert.equal(app.body.getAttribute('data-source-status'), 'connected');
  assert.equal(app.body.className, 'stage-lyrics');
  assert.equal(app.element('banner-layerB').textContent, 'First lyric');
});

test('an old live item response cannot revive stale content after a disconnect', () => {
  const app = browser('banner', { websocket: true, liveDelayMs: 100 });
  app.online.openlp = false;
  app.sockets[0].close();
  app.advance(100);
  assert.equal(app.body.getAttribute('data-source-status'), 'disconnected');
  app.online.openlp = true;
  app.advance(1100);
  assert.equal(app.body.getAttribute('data-source-status'), 'connected');
  assert.equal(app.element('banner-layerB').textContent, 'Original lyric');
});

test('pySSP WebSocket shows the next cached lyric without another HTTP live-item fetch', () => {
  const app = browser('banner', {
    websocket: true,
    pysspSlides: [
      { selected: true, text: 'First pySSP lyric', title: 'pySSP item', img: '' },
      { selected: false, text: 'Second pySSP lyric', title: 'pySSP item', img: '' },
    ],
  });
  app.values.stage_banner_source = '1';
  app.advance(800);
  assert.equal(app.sockets[1].url, 'ws://10.0.0.155:5051');
  assert.equal(app.element('banner-layerA').textContent, 'First pySSP lyric');
  const liveRequests = () => app.requests.filter(r => r.port === '5050' && r.path === '/api/v2/controller/live-items');
  assert.equal(liveRequests().length, 1);
  app.pollStates.pyssp.slide = 1;
  app.sockets[1].emit(app.pollStates.pyssp);
  assert.equal(app.element('banner-layerB').textContent, 'Second pySSP lyric');
  assert.equal(liveRequests().length, 1);
  app.pollStates.pyssp.blank = true;
  app.sockets[1].emit(app.pollStates.pyssp);
  assert.equal(app.element('banner-layerA').textContent, '');
  app.pollStates.pyssp.blank = false;
  app.sockets[1].emit(app.pollStates.pyssp);
  assert.equal(app.element('banner-layerB').textContent, 'Second pySSP lyric');
  app.slides.pyssp = [{ selected: true, text: 'Next song lyric', title: 'Next song', img: '' }];
  app.pollStates.pyssp.item = 'next-song';
  app.pollStates.pyssp.slide = 0;
  app.sockets[1].emit(app.pollStates.pyssp);
  assert.equal(app.element('banner-layerA').textContent, 'Next song lyric');
  assert.equal(liveRequests().length, 2);
  app.advance(1400);
  assert.equal(liveRequests().length, 2);
});

test('pySSP falls back to HTTP after its WebSocket closes', () => {
  const app = browser('banner', { websocket: true });
  app.values.stage_banner_source = '1';
  app.advance(800);
  app.online.pyssp = false;
  app.sockets[1].close();
  assert.equal(app.body.getAttribute('data-source-status'), 'disconnected');
  app.online.pyssp = true;
  app.advance(1100);
  assert.equal(app.body.getAttribute('data-source-status'), 'connected');
  assert.equal(app.body.className, 'stage-lyrics');
});
