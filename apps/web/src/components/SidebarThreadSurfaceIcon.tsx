// FILE: SidebarThreadSurfaceIcon.tsx
// Purpose: Gives non-chat thread surfaces a consistent visual identity in sidebar rows.
// Layer: Sidebar presentation primitive

import type { ThreadSurface } from "@synara/contracts";

import { CanvasIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { SidebarGlyph } from "./sidebarGlyphs";

export function SidebarThreadSurfaceIcon({
  surface,
  isActive,
}: {
  surface?: ThreadSurface | undefined;
  isActive: boolean;
}) {
  if (surface !== "canvas") return null;

  return (
    <span
      data-thread-surface-icon="canvas"
      title="Canvas drawing"
      className={cn(
        "inline-flex shrink-0 items-center",
        isActive ? "text-foreground/80" : "text-muted-foreground/65",
      )}
    >
      <SidebarGlyph icon={CanvasIcon} variant="chrome" />
    </span>
  );
}
