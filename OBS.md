# Fix vmixOverlay issue on OBS

Please use this custom CSS on OBS browser source if there is display issue.

```CSS
/* FULLSCREEN BASE */
html, body {
  width: 100vw !important;
  height: 100vh !important;
  margin: 0 !important;
}

/* POSITION CAPTION BOTTOM CENTER */
#lyric-container {
  position: fixed !important;
  left: 50% !important;
  bottom: 10% !important;   /* adjust height here */

  transform: translateX(-50%) !important;

  width: 90vw !important;
}

/* SINGLE LINE CAPTION TEXT */
.lyric-layer {
  display: block !important;
  width: 100% !important;

  text-align: center !important;

  font-size: 2.5vw !important;
  line-height: 1.2 !important;

  white-space: nowrap !important;         /* 🔥 force one line */
  writing-mode: horizontal-tb !important; /* 🔥 prevent vertical */

  word-break: keep-all !important;        /* extra safety */

  color: #ffffff !important;

  text-shadow:
    0 0 6px rgba(0,0,0,0.8),
    0 0 12px rgba(0,0,0,0.9),
    0 0 24px rgba(0,0,0,1) !important;
}

/* REMOVE LINE BREAKS FROM SOURCE */
.lyric-layer br {
  display: none !important;
}
```