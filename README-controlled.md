# Companion-controlled stage views

Four new copies are available alongside the existing OpenLP views:

| View | URL on this OpenLP computer | Companion variables |
| --- | --- | --- |
| Banner | `http://localhost:4316/stage/banner-controlled/` | `stage_banner_mode`, `stage_banner_source` |
| Overhead | `http://localhost:4316/stage/overhead-controlled/` | `stage_overhead_mode`, `stage_overhead_source` |
| vMix bottom overlay | `http://localhost:4316/stage/vmixOverlay-controlled/` | `stage_vmixoverlay_mode`, `stage_vmixoverlay_source` |
| vMix center overlay | `http://localhost:4316/stage/vmixcenter-controlled/` | `stage_vmixcenter_mode`, `stage_vmixcenter_source` |

Each folder has its own `config.json`. `screen_name` identifies the browser page. `screen_id` selects the Companion variable prefix and should only change together with the Companion controls. `companion_ip` and `companion_port` point to Companion's HTTP API. `poll_interval_ms` controls Companion polling (300 ms in the supplied configs). OpenLP and pySSP send slide changes over WebSocket, so they display from the cached live item without waiting for the next HTTP poll. `openlp_fallback_poll_ms` and `pyssp_fallback_poll_ms` control HTTP polling when the selected source's socket is unavailable.

The mode values are `lyrics`, `title`, and `blank`. The title card shows the current live service item's title. Set `service_name` in a view's config to use a fixed whole-service title instead. On the vMix views, blank means a fully transparent overlay. On the banner and overhead views, blank is black. OpenLP's blank and theme states and pySSP's lyric blank state also hide lyrics; the Companion title mode can still show the title card. The OpenLP `display` flag is ignored.

## Sources

Source `0` is the original OpenLP machine. An empty `host` for source 0 uses the hostname in the stage page URL, so a remote browser still reaches the OpenLP machine. Source `1` is already configured as pySSP on `10.0.0.155:5050`. Add more entries to any view's `sources` array, for example:

```json
"sources": [
  { "id": 0, "type": "openlp", "host": "", "port": 4316 },
  { "id": 1, "type": "pyssp", "host": "10.0.0.155", "port": 5050 },
  { "id": 2, "type": "openlp", "host": "10.0.0.156", "port": 4316, "ws_port": 4317 }
]
```

For OpenLP and pySSP, `ws_port` is optional and defaults to the HTTP port plus one: 4317 and 5051 in the supplied configuration. Set it explicitly if another workstation uses a different WebSocket port. Set that screen's `stage_<screen_id>_source` Companion variable to an ID to switch sources. Page 15 has individual mode and source buttons, **ALL Lyrics**, **ALL Title**, **ALL Blank**, **ALL Source 0**, and **ALL pySSP 1**. Individual buttons light when their variable matches; bulk buttons light when all four variables match. For another source ID, add a Companion custom-variable action that sets the source variable directly to that ID. Reload the stage page after editing `config.json`.

The pySSP source must run a version with cross-origin reads enabled for `/api/health` and `/api/v2/controller/live-items`; the corresponding update is in the sibling `pySSP` Git repo. Remote OpenLP must expose its read API to the viewing browser.

## Disconnects and refresh

If the selected lyric source stops responding, the view holds the last content for ten seconds, then goes black or transparent. Both sources reconnect their WebSocket and keep HTTP polling during an outage, so the view recovers automatically when OpenLP or pySSP restarts. A Companion outage leaves the last mode and source selected in the open page; the Companion mode and source variables are persistent across Companion restarts.

All four views watch `stage_force_refresh`. Changing its value reloads each open page. Companion page 15 includes **Refresh All Views**. The first value seen at page load is a baseline, so loading a view does not cause a refresh loop.

## Deployment

Edit the files in this Git repo, then run `./deploy-controlled.ps1` from PowerShell. It copies the four controlled folders into `%APPDATA%\openlp\data\stages` and verifies the main files. `controlled-stage.js` is the shared source; the deploy script copies it to each view's `stage.js`. The existing stage folders are untouched.

`scripts/configure_companion.py` sets up the page 15 buttons and variables through the sibling `companion-mcp` project. It refuses to replace unrelated buttons.
