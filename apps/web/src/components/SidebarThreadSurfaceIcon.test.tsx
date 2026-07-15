import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarThreadSurfaceIcon } from "./SidebarThreadSurfaceIcon";

describe("SidebarThreadSurfaceIcon", () => {
  it("renders a labeled SVG for Canvas threads", () => {
    const markup = renderToStaticMarkup(
      <SidebarThreadSurfaceIcon surface="canvas" isActive={false} />,
    );

    expect(markup).toContain('data-thread-surface-icon="canvas"');
    expect(markup).toContain('title="Canvas drawing"');
    expect(markup).toContain("<svg");
  });

  it("leaves ordinary chat threads unchanged", () => {
    expect(
      renderToStaticMarkup(<SidebarThreadSurfaceIcon surface="chat" isActive={false} />),
    ).toBe("");
  });
});
