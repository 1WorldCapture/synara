---
name: canvas
description: Create and edit structured, editable diagrams on Synara's shared Canvas. Use for architecture, flows, maps, layouts, annotations, and other spatial explanations whose elements should remain movable and revisable; use an image-generation skill instead when the request is primarily for a raster illustration or photorealistic artwork.
---

# Canvas

Create a clear, editable drawing while preserving the user's ability to watch and revise it.

## Decide and collaborate

- Use Canvas for diagrams, spatial explanations, and edits to the existing shared drawing.
- Ask one focused question only when an ambiguity changes the factual structure or intended layout. Choose sensible defaults for visual details.
- Honor other Skills selected for the current turn. Combine their guidance when useful; do not treat Canvas as an exclusive tool route.
- Preserve every existing element the user did not ask to change. Reuse stable element IDs when updating content.

## Draw incrementally

1. Call `read` to inspect the saved drawing and its revision.
2. Call `begin` once before making changes.
3. Call `append` repeatedly with small semantic batches, normally 3–8 related elements. Make each batch independently understandable so the user sees useful progress before the drawing is complete.
4. Call `commit` once after the requested drawing is complete, or `cancel` if it cannot be completed safely.

Never collapse a non-trivial drawing into one large `append`. Put a `cameraUpdate` operation before each new region so the viewport follows the work.

The `elements` argument to `append` is a JSON array string. Normal elements use stable IDs and Excalidraw properties such as `type`, `x`, `y`, `width`, `height`, `label`, `points`, and `endArrowhead`. Use these pseudo-elements when needed:

```json
{"type":"cameraUpdate","x":0,"y":0,"width":800,"height":600}
{"type":"delete","ids":"obsolete-id,another-id"}
```

Use readable text, consistent directions, clear hierarchy, and restrained fills. Preview batches do not save the drawing. `commit` performs the single revision-checked atomic save; `cancel` leaves the last saved drawing unchanged.
