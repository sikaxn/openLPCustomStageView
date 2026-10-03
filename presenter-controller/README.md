# Presenter Controller

Open on the OpenLP computer: http://localhost:4316/stage/presenter-controller/

On a phone or tablet connected to the same network, replace `localhost` with the OpenLP computer's LAN address. Use the configured remote port if it differs from 4316. No restart should be required.

- Left: slides in the current live item, thumbnails when OpenLP supplies them, otherwise text. Tap a slide to show it. Current-slide changes automatically scroll into view; Go to current returns after manual browsing.
- Right: current slide image or text. Previous and Next stay within the current item. Blank screen toggles the projector's blank state; the controller preview stays visible.
- OpenLP remote authentication is supported. Credentials and tokens are not persisted; sign in again after reloading.
- All scripts, styles, fonts and requests are local. No CDN, package install, or internet connection is needed. The OpenLP server must remain reachable.

Targets iOS 10 Safari and Android 5+ Chrome-class browsers with ES5 JavaScript, XMLHttpRequest and basic flexbox. Landscape is recommended; portrait keeps both columns. Actual decade-old hardware has not been tested. Native legacy Android Browser is not a supported target.

State polling runs every 800 ms after the previous request completes, with reconnect backoff. Thumbnail data is reloaded only when the live item, service revision or slide counter changes. Failed control requests are never automatically retried. Video and animation previews are limited to the still image/text supplied by OpenLP.

API: `/api/poll`, `/api/v2/controller/live-items`, POST `/api/v2/controller/show`, POST `/api/v2/controller/progress`, POST `/api/v2/core/display`, POST `/api/v2/core/login`.

Custom stage routing follows https://manual.openlp.org/stage_view.html and control payloads were checked against the local OpenLP source and companion-module-openlp-http.
