/* Local preview zoom. ES5, Touch Events and prefixed transforms for old tablets. */
(function () {
  'use strict';
  var preview = document.getElementById('preview');
  var content = document.getElementById('preview-content');
  var text = document.getElementById('preview-text');
  var tools = document.getElementById('preview-zoom');
  var plus = document.getElementById('zoom-in');
  var minus = document.getElementById('zoom-out');
  var reset = document.getElementById('zoom-reset');
  var scale = 1, x = 0, y = 0, gesture = null, mouse = null;
  var tap = null, lastTap = 0, outsideTap = 0, touchOptions = false;

  /* Old browsers take a boolean; modern browsers need explicit passive:false. */
  try {
    var probe = Object.defineProperty({}, 'passive', { get: function () { touchOptions = { passive: false }; } });
    var noop = function () {};
    window.addEventListener('preview-passive-test', noop, probe);
    window.removeEventListener('preview-passive-test', noop, probe);
  } catch (error) { touchOptions = false; }
  function listen(target, name, handler) { target.addEventListener(name, handler, touchOptions); }
  function prevent(event) { if (event.cancelable !== false) { event.preventDefault(); } }
  function inside(target, parent) {
    while (target) { if (target === parent) { return true; } target = target.parentNode; }
    return false;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function draw() {
    x = clamp(x, -preview.clientWidth * (scale - 1), 0);
    y = clamp(y, -preview.clientHeight * (scale - 1), 0);
    var transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
    content.style.transform = transform;
    content.style.webkitTransform = transform;
    preview.className = 'preview' + (scale > 1 ? ' zoomed' : '');
    reset.textContent = Math.round(scale * 100) + '%';
    minus.disabled = scale <= 1;
    plus.disabled = scale >= 4;
  }
  function resetZoom() {
    scale = 1; x = 0; y = 0; gesture = null; mouse = null; tap = null; lastTap = 0;
    text.scrollTop = 0; text.scrollLeft = 0;
    draw();
  }
  function zoomTo(value, px, py) {
    var next = clamp(value, 1, 4);
    x = px - (px - x) * next / scale;
    y = py - (py - y) * next / scale;
    scale = next; draw();
  }
  function centerZoom(value) { zoomTo(value, preview.clientWidth / 2, preview.clientHeight / 2); }
  plus.onclick = function () { centerZoom(scale * 1.25); };
  minus.onclick = function () { centerZoom(scale / 1.25); };
  reset.onclick = resetZoom;
  function point(touch) {
    var box = preview.getBoundingClientRect();
    return { x: touch.clientX - box.left, y: touch.clientY - box.top };
  }
  function pair(touches) {
    var a = point(touches[0]), b = point(touches[1]);
    var dx = a.x - b.x, dy = a.y - b.y;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.sqrt(dx * dx + dy * dy)) };
  }
  function beginPinch(touches) {
    var p = pair(touches);
    gesture = { type: 'pinch', distance: p.distance, scale: scale, anchorX: (p.x - x) / scale, anchorY: (p.y - y) / scale };
    tap = null;
  }
  function beginPan(touch) {
    var p = point(touch);
    gesture = { type: 'pan', px: p.x, py: p.y, x: x, y: y };
  }
  function panTo(p, start) {
    x = start.x + p.x - start.px;
    var desiredY = start.y + p.y - start.py;
    var boundedY = clamp(desiredY, -preview.clientHeight * (scale - 1), 0);
    /* Once the zoomed viewport reaches an edge, continue scrolling long text. */
    if (!text.hidden && desiredY !== boundedY) {
      text.scrollTop += (boundedY - desiredY) / scale;
      start.py = p.y; start.y = boundedY;
    }
    y = boundedY; draw();
  }
  listen(preview, 'touchstart', function (event) {
    if (inside(event.target, tools)) { return; }
    if (event.touches.length >= 2) { prevent(event); beginPinch(event.touches); }
    else if (event.touches.length === 1) {
      var p = point(event.touches[0]);
      tap = { x: p.x, y: p.y, time: Date.now() };
      if (scale > 1) { prevent(event); beginPan(event.touches[0]); }
    }
  });
  listen(preview, 'touchmove', function (event) {
    if (inside(event.target, tools)) { return; }
    if (tap && event.touches.length) {
      var p = point(event.touches[0]);
      if (Math.abs(p.x - tap.x) + Math.abs(p.y - tap.y) > 8) { tap = null; }
    }
    if (event.touches.length >= 2) {
      prevent(event);
      /* A slide change cancels the ongoing gesture until fingers are lifted. */
      if (!gesture) { return; }
      if (gesture.type !== 'pinch') { beginPinch(event.touches); }
      var pairNow = pair(event.touches);
      scale = clamp(gesture.scale * pairNow.distance / gesture.distance, 1, 4);
      x = pairNow.x - gesture.anchorX * scale;
      y = pairNow.y - gesture.anchorY * scale;
      draw();
    } else if (event.touches.length === 1 && gesture && gesture.type === 'pan') {
      prevent(event); panTo(point(event.touches[0]), gesture);
    }
  });
  listen(preview, 'touchend', function (event) {
    if (inside(event.target, tools)) { return; }
    if (event.touches.length === 1 && gesture) {
      tap = null;
      if (scale > 1) { beginPan(event.touches[0]); } else { gesture = null; }
    } else if (!event.touches.length) {
      var now = Date.now();
      if (tap && now - tap.time < 300) {
        if (lastTap && now - lastTap < 300) {
          prevent(event); zoomTo(scale > 1 ? 1 : 2, tap.x, tap.y); lastTap = 0;
        } else { lastTap = now; }
      } else { lastTap = 0; }
      gesture = null; tap = null;
    }
  });
  listen(preview, 'touchcancel', function () { gesture = null; tap = null; lastTap = 0; });
  listen(preview, 'dblclick', function (event) {
    if (inside(event.target, tools)) { return; }
    prevent(event); var p = point(event); zoomTo(scale > 1 ? 1 : 2, p.x, p.y);
  });
  listen(preview, 'mousedown', function (event) {
    if (scale <= 1 || event.button !== 0 || inside(event.target, tools)) { return; }
    prevent(event); var p = point(event); mouse = { px: p.x, py: p.y, x: x, y: y };
  });
  listen(document, 'mousemove', function (event) { if (mouse) { prevent(event); panTo(point(event), mouse); } });
  listen(document, 'mouseup', function () { mouse = null; });

  /* Prevent browser page zoom while preserving normal list/text scrolling. */
  function blockPagePinch(event) { if (event.touches.length > 1) { prevent(event); } }
  listen(document, 'touchstart', blockPagePinch);
  listen(document, 'touchmove', blockPagePinch);
  listen(document, 'touchend', function (event) {
    if (inside(event.target, preview) || event.touches.length) { return; }
    var now = Date.now();
    if (outsideTap && now - outsideTap < 300) { prevent(event); }
    outsideTap = now;
  });
  listen(document, 'gesturestart', prevent);
  listen(document, 'gesturechange', prevent);
  listen(document, 'gestureend', prevent);
  listen(document, 'wheel', function (event) {
    if (!event.ctrlKey && !event.metaKey) { return; }
    prevent(event);
    if (inside(event.target, preview) && !inside(event.target, tools)) {
      var p = point(event); zoomTo(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y);
    }
  });
  listen(document, 'keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '0' || event.keyCode === 187 || event.keyCode === 189 || event.keyCode === 48)) { prevent(event); }
  });
  window.addEventListener('resize', function () { gesture = null; mouse = null; draw(); }, false);
  window.PresenterPreview = { reset: resetZoom };
  resetZoom();
}());
