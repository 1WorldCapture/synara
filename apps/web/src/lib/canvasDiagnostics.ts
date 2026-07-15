// FILE: canvasDiagnostics.ts
// Purpose: Emits timestamped Canvas delivery breadcrumbs that can be aligned with server logs and SQLite events.
// Layer: Canvas diagnostics

export function logCanvasDiagnostic(
  stage: string,
  details: Readonly<Record<string, unknown>> = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    stage,
    ...details,
  };
  try {
    console.info("[canvas-diagnostic]", JSON.stringify(record));
  } catch (error) {
    console.warn("[canvas-diagnostic] failed to serialize", { stage, error });
  }
}
