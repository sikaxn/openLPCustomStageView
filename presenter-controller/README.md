# Presenter Controller

Open on the OpenLP computer: http://localhost:4316/stage/presenter-controller/

On a phone or tablet connected to the same network, replace `localhost` with the OpenLP computer's LAN address. Use the configured remote port if it differs from 4316. No restart should be required.

- Left: slides in the current live item, thumbnails when OpenLP supplies them, otherwise text. Tap a slide to show it. Current-slide changes automatically scroll into view; Go to current returns after manual browsing.
- Go to current and manual list scrolling remain available during Hold, media and desktop locks. Slide selection and presentation controls still follow the locks.
- Right: current slide image or text. Previous and Next stay within the current item. Blank screen toggles the projector's blank state; the controller preview stays visible.
- Presentation controls lock while a media item is live. Desktop display and Companion Hold locks are configurable. A message explains when the AV room has control. OpenLP does not expose playback state in these endpoints, so a paused or stopped media item stays locked until another item is selected.
- OpenLP remote authentication is supported. Credentials and tokens are not persisted; sign in again after reloading.
- The top bar shows the device's local date and time, updating every second. Fullscreen toggles browser fullscreen using standard or older vendor APIs; it remains available while presentation controls are locked. On older iPads without page fullscreen support, the button explains how to use Safari's Share > Add to Home Screen and launch the saved app. Home Screen app mode is supported by the page's Apple web-app metadata.
- Lock notices, display/Companion status, errors and fullscreen help appear in the middle of the fixed-height top bar, between the title and clock/fullscreen controls. Notifications have no scrollbar. Showing or hiding notifications does not resize the preview.
- Page zoom gestures are blocked. Pinch or double-tap the preview to zoom (100–400%), drag to pan, or use its − / percentage / + buttons. The percentage button resets zoom. Image and text previews both support zoom. Every change of live slide or live item resets zoom, panning and text scrolling, whether changed here or in OpenLP. Polling the same slide keeps zoom intact. Normal scrolling in the slide list and unzoomed text is preserved.
- All scripts, styles, fonts and requests are local. No CDN, package install, or internet connection is needed. The OpenLP server must remain reachable.

Targets iOS 10 Safari and Android 5+ Chrome-class browsers with ES5 JavaScript, XMLHttpRequest and basic flexbox. Landscape is recommended; portrait keeps both columns. Actual decade-old hardware has not been tested. Native legacy Android Browser is not a supported target.

Edit `config.json` in this folder and reload the controller to apply changes. These are the defaults:

```json
{
  "lock_on_show_desktop": true,
  "fetch_interval_ms": 800,
  "allow_zoom": true,
  "companion_ip": "10.0.0.155",
  "companion_port": 8000,
  "lock_on_companion_hold": true
}
```

| Setting | Meaning |
| --- | --- |
| `lock_on_show_desktop` | Lock presentation controls while OpenLP shows the desktop. Set `false` to allow controls in desktop mode. |
| `fetch_interval_ms` | Delay in milliseconds between completed polling requests. Applies independently to OpenLP and Companion; whole numbers from 100 to 60000. |
| `allow_zoom` | Allow preview zoom for both image slides and text. Set `false` to hide zoom buttons and disable preview zoom gestures. Page zoom remains blocked. |
| `companion_ip` | Companion's LAN IP address or hostname, without a scheme or port. An empty string uses the OpenLP host from the page URL. Avoid `localhost` when using tablets. |
| `companion_port` | Companion HTTP port, default 8000; whole numbers from 1 to 65535. |
| `lock_on_companion_hold` | Enable polling of `$(custom:ready)` and lock on Hold. Set `false` to stop all Companion requests. |

Companion is read with a simple GET to `http://<companion_ip>:<companion_port>/api/custom-variable/ready/value`. No OpenLP credentials are sent to Companion, and the controller never writes to the variable.

| Variable value | Mode | Companion control lock |
| --- | --- | --- |
| `0` | Hold | Locked |
| `1` | Ready | Released |
| `3` | Wait | Released |
| Any other value | Unknown | Released |
| Not connected / request fails | Unavailable | Released |

If Companion disconnects, any Companion Hold lock is cleared as soon as the request fails or its 3-second timeout expires. The controller continues polling and recovers automatically. OpenLP media/desktop locks and OpenLP connection/authentication requirements apply independently. Companion's HTTP API must be enabled and its response must allow the OpenLP page's origin; your running instance was checked and allows it. Use the usual HTTP OpenLP stage URL for this HTTP Companion endpoint.

Polling uses the configured interval after each request completes, with reconnect backoff up to 5 seconds (or the configured interval if longer). Thumbnail data is reloaded only when the live item, service revision or slide counter changes. Failed control requests are never automatically retried. Video and animation previews are limited to the still image/text supplied by OpenLP. Missing config fields use defaults; an unreadable or invalid config shows a warning and uses all built-in defaults.

API: `/api/poll`, `/api/v2/controller/live-items`, POST `/api/v2/controller/show`, POST `/api/v2/controller/progress`, POST `/api/v2/core/display`, POST `/api/v2/core/login`.

Custom stage routing follows https://manual.openlp.org/stage_view.html and control payloads were checked against the local OpenLP source and companion-module-openlp-http.
