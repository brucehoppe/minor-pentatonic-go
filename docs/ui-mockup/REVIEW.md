# UI review: a quieter risograph practice desk

**Adopted:** this design is now integrated into `web/`. The former preview URL opens the real app. The notes below record the original review; the floating playback bar was replaced by an inline panel after visual feedback.

The risograph identity is worth keeping: paper, blue/pink ink, offset title, embedded Bricolage Grotesque and DM Mono, and the guitar artwork. Most clutter comes from presenting navigation, setup and teaching content at the same visual priority.

## Findings and recommendations

| Priority | Evidence in current code | Recommendation |
|---|---|---|
| High | `web/index.html:18–55` places the large illustration, keys, navigation, toolbar and complete legend before the first lesson. `web/app.js:4372` declares 26 views. | Use a compact illustrated masthead and collapsible lesson groups beside the content. Collapse the whole index on small screens. Keep all lessons discoverable with descriptive group labels. |
| High | `web/app.js:4414` already determines which tools a view uses, but only dims and disables unused rows. | Reuse this configuration to omit irrelevant controls. Keep key/root visible where relevant; place register, dot labels and overlays under Diagram settings. In a production version, summarize non-default settings on the closed disclosure. |
| High | `web/app.js:971` repeats the current goal/test in Today and again in the current stage, then renders the entire course. | Show the current stage once, with its actions. Put other stages and explanatory advice under expandable sections. Preserve access to completed stages and their undo actions. |
| Medium | `web/app.css:109–115` applies similar bordered cards and uppercase titles widely; instructional copy is 11.5px with reduced opacity. | Reserve ink emphasis for the page title, selected lesson and current exercise. Increase instructional text size and contrast. Use fewer enclosing borders and sentence case within lessons. |
| Medium | The trainer exposes form, feel, band, swing, bass, ride, chorus, tempo ladder, key cycling, drill and four mix controls together in `web/index.html` under `#v-trainer`. | Keep form, feel and Start visible. Group less frequent choices under Band, mix & practice options. Keep playing status and live form visible. |
| Medium | `web/app.css:108` gives wide grids a 330px minimum column, which exceeds the content width on some narrow phones. | Use `minmax(0,1fr)` for narrow screens and contain fretboard scrolling inside diagrams. Retain visible keyboard focus and comfortable controls. |

## Mockup

Open `http://127.0.0.1:8766/docs/ui-mockup/` while the preview server is running. It opens on 5 boxes; try Fundamentals → Start here, Diagram settings, and Practice → 12-bar trainer. The top link opens the current interface for comparison.

To restart the preview from the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

The mockup uses a copy of the page markup and the real app's local scripts, fonts and images. Its presentation changes live only in this directory. No changes were made to the shipped `web/` files. The preview origin has separate browser storage from the normal application on port 7534.

This is a review prototype, not the proposed production architecture. If adopted, implement the shell directly in the real markup and navigation renderer; do not ship the mockup's DOM relocation, render wrapper or course MutationObserver. Retain view-specific state and audio lifecycle behavior. Add browser coverage for switching views, keyboard disclosures, settings persistence, narrow screens and focus during redraws. The existing DOM stand-in tests alone cannot validate layout.

## Validation and boundaries

- Existing `go test ./...` suite passed (including the frontend tests).
- JavaScript syntax check and Git whitespace check passed.
- Safari: loaded the mockup; verified Diagram settings expands, Box 1 selection updates the map label, navigation switches to Start here, irrelevant controls disappear, and the full learning path is collapsed.
- Desktop visual inspection completed. Responsive rules are included, but physical phone layout and touch behavior have not been verified.
- Audio, microphone capture, exports and every lesson were not revalidated as part of this layout study.
- Review scope: interface structure, rendering and presentation code; not a comprehensive security or music-engine audit.
