# Physical-device observations

## 2026-11-14 — handwriting to text

- Device supplied by the tester: iPad Pro 11-inch M4, Apple Pencil Pro.
- iPadOS version and active recognition/keyboard language: not recorded yet.
- Tester feedback: writing with Pencil works very well in the text block and
  when using **Skriv med penna**.
- An early snapshot recorded 41 native-field input events and three explicit
  handwriting-to-block commits. This shows the helper path was exercised;
  the log alone does not prove recognition accuracy.
- Correction after reviewing `client-rzcp637wzm.json`: the original summary
  counted only `input`, but BlockSuite normally prevents `beforeinput` and
  changes its Yjs model itself. Zero in that summary was a measurement defect,
  not an absence of editor input events. The retained event log contains seven
  editor `beforeinput/insertText` events, plus three editor `beforeinput` events
  with an empty input type. It records no editor `input` events. This supports
  direct input reaching the editor, alongside the tester's successful-use
  report; individual events alone do not establish recognition accuracy.
- At correction time, the same report had accumulated 87 native `beforeinput`
  and 87 native `input` events. Counts can grow while a session remains active;
  they should not be compared as if different snapshots were one fixed run.
- Diagnostics version 2 counts `beforeinput` for both surfaces and reports
  `beforeinput` and `input` separately. These are editing-intention events, not
  a count of characters or successful model changes. Automated tests separately
  verify the actual document mutation and synchronization.
- No independent observation of the physical screen was made. This is positive
  manual feedback, not a complete Pencil/Safari acceptance test.

Next regression checks: write Swedish characters, continue an existing paragraph,
correct a word, undo the insertion, and reload after synchronization. Keep the
direct-editor and native-field paths distinct in future reports.

## 2026-11-14 — missing history and input switching

The tester supplied an iPad Safari screenshot and reported that no undo button
was visible and switching between Pencil and keyboard was difficult. The lab now
adds document undo/redo, separate draft undo/redo and a keyboard entry button
sharing the existing Pencil field. Physical verification of the new controls
and iPadOS keyboard presentation is still pending.

## 2026-11-14 — ambiguous whiteboard insertion tools

The tester circled the three illustrated senior-tool buttons in an iPad Safari
screenshot and reported that their purpose and how to pick items were unclear.
The lab replaces those entries with named shape, insertion and template menus,
offering tap-to-insert choices instead of requiring a precise drag. Physical
verification of the new menus is pending.

Follow-up the same night: the tester rejected the named **Former** panel. Its
text-only buttons showed no shapes, inserted a fixed size in the viewport
centre, covered half the canvas and gave its heading a heavy focus ring. The
native shape tool is restored; with real Chromium touch input, a tap opens its
shape and colour menu, and a tap or drag on the canvas places the shape.
**Infoga** and **Mallar** are unchanged; iPad confirmation is pending. Other concurrent core touch changes
in the checkout are separate from this lab-only menu adaptation.

## 2026-11-14 — system editing bar over the address bar

The tester circled a dark Undo/Cut/Copy/Paste/Redo bar covering Safari's
address bar in the whiteboard (screenshot 11:03). It is iPadOS's own editing
bar, not BlockSuite UI. Report `client-q5vbwo7756.json` shows no editable
element focused (only `EDITOR-HOST` and `H1`), but 13 moments with three
simultaneous touch contacts between 11:02 and 11:03, some with palm-sized
contact widths. Three fingers on the screen are iPadOS's editing gesture, which
opens exactly this bar.

The lab now cancels touch events while three or more contacts are down
(`three-finger-touch` events, `systemGestureBlocks` in the summary). Chromium
confirms the cancellation and that two-finger touches stay untouched. Whether
iPad Safari then suppresses its system gesture is unknown; physical
verification is pending. The whiteboard itself uses no three-finger gesture.
