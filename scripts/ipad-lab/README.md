# CW iPad test lab

See [physical-device observations](MANUAL_TESTS.md) for tester feedback and the
scope of the supporting diagnostics.

A separate baseline host for BlockSuite's current document and whiteboard views.
It does not change imported source, use AFFiNE's backend, or connect to the CW
production application. `TestWorkspace` is intentionally used for this test
harness only. The lab reuses the installed, locked workspace dependencies.

## Start on the Mac

Use the Node version in `.nvmrc`, then:

```sh
yarn test:ipad
```

Keep the process running. On the same local network, open one of the printed
network links in iPad Safari. `127.0.0.1` works only on the Mac. The link contains
the session token; retain it when opening `monitor.html`. Do not forward the port
to the public Internet. The default is port 4173; `IPAD_LAB_PORT` changes it.

The server serves only the built test app. APIs require the random session token.
Test documents and bounded device reports are stored in the printed temporary
directory (`IPAD_LAB_DATA_DIR` overrides it). No real customer data is needed.
Restarting keeps the document but rotates the token. Use another `room` value in
the URL to start a fresh baseline without deleting previous test documents.
For a deliberate lab update, `--resume` reuses the token from the saved local
session so existing iPad links keep working; stop the old server first.

The initial LAN link uses HTTP. Safari's secure-context clipboard API is not
available there; the test panel reports `secureContext` and `clipboardAPI` so this
is not mistaken for an editor regression. Full clipboard/PWA testing needs an
HTTPS test origin trusted by the iPad. Native selection/copy menus should also
be checked separately. No certificate is installed by this script.

The app uses its own small HTTP/Yjs test transport, exchanging state-vector
differences approximately every 500 ms while active. This is not a benchmark of
CW's production sync provider. Each browser also caches the document in IndexedDB.
Suspended tabs resume on their next successful exchange. Wait for “Synkad” before
closing; browser background termination before the local cache write can lose
recent unsent edits. Images/files and remote participant cursors are outside the
first lab's scope. The server persists Yjs state, not rendered screenshots.

## First physical test: iPad Pro 11-inch M4 + Apple Pencil Pro

1. Connect the iPad to the Mac with a data-capable USB cable and trust the Mac.
2. Open the network test link in Safari. Name the device in **Testpanel**.
3. On iPad, enable **Settings → Apps → Safari → Advanced → Web Inspector**.
4. On Mac Safari, enable developer features, then select the iPad's page in the
   **Develop** menu. This exposes DOM, JavaScript and network diagnostics.
5. For the actual screen, use QuickTime Player → **File → New Movie Recording**
   and select the iPad as the camera source. A screen visible in QuickTime can be
   inspected through available Mac computer-use tools; this does not remotely
   operate the Pencil or provide automatic continuous screen access.
6. Open `monitor.html` with the same query string on the Mac for reported pointer
   events, pressure, tilt, viewport/keyboard changes, errors and observations.

Document the iPadOS version, Pencil model and orientation with the run. Do not
infer a passing hardware test from emulation or synthetic pointer events.

| Scenario | Check on the actual iPad |
| --- | --- |
| Pen | Choose the native pen tool; draw slowly/quickly and vary pressure. |
| Palm | Rest the hand while drawing; check accidental strokes/selections. |
| Touch | Try pan and pinch zoom, including while the pen tool is selected. |
| Blocks | Select, reorder and drag blocks; note ambiguous gestures. |
| Text | Open the software keyboard; type, select, copy/paste, rotate and dismiss it. |
| Sync | Open the same room on Mac; edit both sides, disconnect/reconnect and reload. |

The lab passively observes events and does not implement a new finger-versus-pen
policy. Any failures above are baseline findings to fix later. Use **Fungerar**
or **Problem** with a note. Export local diagnostics if the network is unavailable.
The older iPad generation 9 is the second touch/text/performance comparison device;
its Pencil generation 1 can be tested later.

### Handwriting to text comparison

Use **Skriv med penna** to open a normal Safari textarea. Write a short sentence
with Pencil, select an existing paragraph (or **Nytt textblock**) and explicitly
append the recognized text with **Lägg till i textblocket**. Existing content is
preserved. Then compare writing the same sentence directly in an editable block
in **Dokument** mode. This is a diagnostic/assisted entry path, not a fix to
BlockSuite's direct Scribble integration and not a custom recognition service.

Check the iPad's Scribble setting, keyboard language and iPadOS version. The log
distinguishes native textarea and editor input/composition events without logging
their text contents. Browser automation can validate insertion, composition
handling and Yjs synchronization; actual handwriting recognition needs Pencil.

Diagnostics version 2 defines `textInputs` as counts of `beforeinput` events on
both surfaces. `textInputEvents` retains separate `beforeinput`/`input` counts.
BlockSuite can cancel `beforeinput` and update the model itself, so editor
activity must not be inferred from `input` alone. These counters measure editing
intentions; successful writes are checked separately against the document model.
Earlier reports used an input-only summary and remain unmodified; interpret them
using their raw `text-input` events. Device name and iPadOS version are manually
entered in the test panel and are not inferred reliably from Safari's user agent.

The toolbar has **Ångra/Gör om** for this session's own document changes (text,
blocks and canvas strokes). They use BlockSuite's local Yjs history and do not
undo another client's changes. History starts fresh when the page reloads.
The writing panel has separate **Ångra/Gör om text i fältet** for an uncommitted
draft; committing clears that draft history and makes document undo apply.

**Skriv med penna** and **Tangentbord** share the same field and block target.
Switching does not discard the draft. Keyboard mode focuses the field
synchronously in the user's click gesture; pen mode dismisses focus without
setting `inputmode=none` or changing the system's Scribble setting. iPadOS may
still show a floating keyboard or Scribble toolbar; the web app cannot promise
which system keyboard presentation appears. Verify that behavior on the iPad.
The panel follows the actual toolbar height and visual viewport when the
keyboard opens, including portrait layouts.

### Named whiteboard menus

Two ambiguous senior-tool pictures are replaced in this test host with
**Infoga** and **Mallar**, using the toolbar's extension identifiers.
**Infoga** offers named buttons for text, mind maps and media. A tap inserts in
the viewport center without requiring a drag gesture. The shape picture keeps
BlockSuite's native shape tool: a tap opens its menu of shape outlines and
colours, and a tap or drag on the canvas places the shape there. A named
**Former** panel was tried and removed after tester feedback: text-only choices
at a fixed size and position were worse than the native picker. At overview zoom below 50%, insertion first returns to 100% so the
new object is usable. Inserted objects use the existing model and undo history.

The host reuses the upstream mind-map/text/media render helpers through a local
source import, which should be reviewed when updating the imported source.
It does not change the upstream toolbar implementation. The template catalog is
empty in this lab; **Mallar** explains that instead of suggesting there are
already loaded templates. A future provided catalog uses named template choices.
Media still follows the lab's existing local blob limitations noted above.

## Automated checks

```sh
yarn verify:ipad
```

Checks two isolated browser contexts, simultaneous first joins, actual typing,
concurrent edits, offline reconnect, reload, server persistence, mode switching,
synthetic pen logging and the monitor. It uses Chromium and additionally WebKit
when that binary is installed. Synthetic input proves logging, not Pencil support.
If WebKit is installed outside Playwright's default cache, explicitly set its
executable. For the temporary binary used in this Mac session:

```sh
IPAD_LAB_WEBKIT_EXECUTABLE=/private/tmp/cw-ipad-browsers/webkit-2248/pw_run.sh yarn verify:ipad
```

Without an available WebKit executable the script prints `SKIP`; a Chromium-only
pass is not evidence of WebKit or physical-iPad compatibility.
For a transport-only development rerun against an existing build, set
`IPAD_LAB_TEST_ASSETS=/absolute/path/to/app`; final verification should rebuild.

## References

- [Inspect iOS and iPadOS from a Mac](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)
- [Capture a connected iPad in QuickTime](https://support.apple.com/en-gb/guide/quicktime-player/qtp356b55534/mac)
- [Playwright emulation](https://playwright.dev/docs/emulation)
- [Playwright WebKit is not branded Safari](https://playwright.dev/docs/browsers#webkit)
