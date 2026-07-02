/**
 * The flagship governed-generation view (M1 PR-7).
 *
 * Talks to `dspack-gen serve` (localhost NDJSON) and replays the pipeline on
 * screen: attempt panels with the surface gates S1/S2/S3 (findings shown with
 * the contract's rationale verbatim), the exact repair message sent, the
 * emitter gates A1/A2/A3 per A2UI version, the rendered surface (off the
 * generated catalog, as everywhere in this demo), and the downloadable audit
 * report v1 — the full trail: prompt → violation → repair → validated output.
 *
 * "Fake pipeline" mode runs the server's deterministic scripted adapter (the
 * golden violating fixture, then the contract's worked example) — the same
 * backend the Playwright gate drives. Live mode needs Ollama (or a hosted
 * model) behind the serve process; the UI is identical.
 */
import { useMemo, useState } from "react";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { A2uiSurface, MarkdownContext, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { renderMarkdown } from "@a2ui/markdown-it";
import type { buildCatalog } from "./ingest";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface GateReport {
  gate: "S1" | "S2" | "S3";
  name: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  errors?: string[];
}
interface Finding {
  ruleId: string;
  type: string;
  requirement: string;
  level: string;
  message: string;
  rationale: string;
  location: { path: string; component: string; nodeId?: string };
  exampleIds: string[];
}
type PipelineEvent =
  | { type: "start"; intent: string; prompt: string; adapterId: string; ruleIds: string[] }
  | { type: "attempt"; index: number; model?: string; surface: unknown; gates: GateReport[]; findings: Finding[] }
  | { type: "repair"; index: number; message: string }
  | { type: "emitted"; validations: Array<{ a2uiVersion: string; gates: Array<{ gate: string; name: string; pass: boolean }> }>; warnings: Array<{ code: string; message: string }> }
  | { type: "done"; outcome: string; exitCode: number; report: unknown; surfaceMessages?: { messages: unknown[] } }
  | { type: "error"; exitCode: number; message: string };

const GATE_LABEL: Record<string, string> = {
  S1: "surface schema",
  S2: "contract vocabulary",
  S3: "governance",
};

export function GenerateView({
  ingested,
  themeVars,
}: {
  ingested: ReturnType<typeof buildCatalog>;
  themeVars: React.CSSProperties;
}) {
  const [serveUrl, setServeUrl] = useState("http://127.0.0.1:8787");
  const [prompt, setPrompt] = useState("a screen to delete my account");
  const [model, setModel] = useState("ollama:qwen3:8b");
  const [fake, setFake] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);

  const done = events.find((e): e is Extract<PipelineEvent, { type: "done" }> => e.type === "done");
  const start = events.find((e): e is Extract<PipelineEvent, { type: "start" }> => e.type === "start");

  const rendered = useMemo(() => {
    if (!done?.surfaceMessages) return null;
    const processor = new MessageProcessor<ReactComponentImplementation>([ingested.catalog], async () => {});
    processor.processMessages(structuredClone(done.surfaceMessages.messages) as any);
    const model = Array.from(processor.model.surfacesMap.values())[0];
    return model ? processor.model.getSurface(model.id) : null;
  }, [done, ingested]);

  async function run() {
    setRunning(true);
    setError(null);
    setEvents([]);
    try {
      const response = await fetch(`${serveUrl}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fake ? { prompt, fake: true } : { prompt, model }),
      });
      if (!response.ok || !response.body) throw new Error(`serve responded ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) setEvents((prev) => [...prev, JSON.parse(line) as PipelineEvent]);
        }
        if (eof) break;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const attempts = events.filter((e): e is Extract<PipelineEvent, { type: "attempt" }> => e.type === "attempt");
  const repairs = events.filter((e): e is Extract<PipelineEvent, { type: "repair" }> => e.type === "repair");
  const emitted = events.find((e): e is Extract<PipelineEvent, { type: "emitted" }> => e.type === "emitted");
  const pipelineError = events.find((e): e is Extract<PipelineEvent, { type: "error" }> => e.type === "error");

  return (
    <div>
      <section style={s.card}>
        <h2 style={s.h2}>Governed generation</h2>
        <p style={s.note}>
          The prompt goes to <code>dspack-gen serve</code>: schema-constrained generation → surface gates
          (S1 schema · S2 vocabulary · S3 governance) → bounded repair → A2UI emission → emitter gates
          (A1–A3) → audit report. The rules and rationales on screen come verbatim from the dspack contract.
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr", marginTop: 8 }}>
          <label style={s.label}>
            Prompt
            <input data-testid="prompt" style={s.input} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <label style={s.label}>
              Intent
              <input style={s.input} value="destructive-action" readOnly />
            </label>
            <label style={s.label}>
              Model (ollama:&lt;tag&gt; | anthropic:&lt;id&gt;)
              <input data-testid="model" style={s.input} value={model} onChange={(e) => setModel(e.target.value)} disabled={fake} />
            </label>
            <label style={{ ...s.label, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <input data-testid="fake-toggle" type="checkbox" checked={fake} onChange={(e) => setFake(e.target.checked)} />
              scripted fixture replay (deterministic fake adapter — not live generation)
            </label>
            <label style={s.label}>
              serve URL
              <input style={s.input} value={serveUrl} onChange={(e) => setServeUrl(e.target.value)} />
            </label>
            <button data-testid="run" style={s.runBtn} onClick={run} disabled={running}>
              {running ? "Running…" : "Generate"}
            </button>
          </div>
        </div>
        {error && (
          <p data-testid="client-error" style={{ ...s.note, color: "#b91c1c" }}>
            {error} — is <code>dspack-gen serve</code> running?
          </p>
        )}
        {pipelineError && (
          <p style={{ ...s.note, color: "#b91c1c" }}>
            pipeline error (exit {pipelineError.exitCode}): {pipelineError.message}
          </p>
        )}
      </section>

      {attempts.map((attempt) => (
        <section key={attempt.index} style={s.card} data-testid={`attempt-${attempt.index + 1}`}>
          <h2 style={s.h2}>
            Attempt {attempt.index + 1}
            {attempt.model ? <span style={s.dim}> · {attempt.model}</span> : null}
          </h2>
          <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
            {attempt.gates.map((gate) => (
              <span
                key={gate.gate}
                data-testid={`gate-${gate.gate}-attempt-${attempt.index + 1}`}
                style={{ ...s.chip, ...(gate.status === "PASS" ? s.chipPass : gate.status === "FAIL" ? s.chipFail : s.chipSkip) }}
              >
                {gate.gate} {GATE_LABEL[gate.gate]}: {gate.status}
              </span>
            ))}
          </div>

          {attempt.findings.length > 0 ? (
            attempt.findings.map((finding, i) => (
              <div key={i} style={s.finding}>
                <div style={{ fontWeight: 600 }}>
                  ✖ {finding.level} [{finding.requirement}] <code>{finding.ruleId}</code>{" "}
                  <span style={s.dim}>[{finding.type}]</span>
                </div>
                <div style={s.dim}>
                  at {finding.location.path} (component: {finding.location.component}
                  {finding.location.nodeId ? `, id: "${finding.location.nodeId}"` : ""})
                </div>
                <div>{finding.message}</div>
                <div style={s.rationale}>Rationale: {finding.rationale}</div>
              </div>
            ))
          ) : (
            <div data-testid={`attempt-${attempt.index + 1}-clean`}>
              {(start?.ruleIds ?? []).map((ruleId) => (
                <div key={ruleId} style={{ ...s.finding, borderLeftColor: "#16a34a" }}>
                  ✓ <code>{ruleId}</code> satisfied — verified by the governance linter, not assumed from
                  prompt steering.
                </div>
              ))}
            </div>
          )}

          {repairs.find((r) => r.index === attempt.index) && (
            <details style={{ marginTop: 8 }} data-testid={`repair-${attempt.index + 1}`} open>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                Repair feedback sent to the model (rendered from the same findings object)
              </summary>
              <pre style={s.pre}>{repairs.find((r) => r.index === attempt.index)!.message}</pre>
            </details>
          )}
        </section>
      ))}

      {emitted && (
        <section style={s.card} data-testid="emitter-gates">
          <h2 style={s.h2}>Emitted to A2UI</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {emitted.validations.flatMap((validation) =>
              validation.gates.map((gate) => (
                <span
                  key={`${validation.a2uiVersion}-${gate.gate}`}
                  data-testid={`gate-${gate.gate}-${validation.a2uiVersion}`}
                  style={{ ...s.chip, ...(gate.pass ? s.chipPass : s.chipFail) }}
                >
                  [{validation.a2uiVersion}] {gate.gate} {gate.name}: {gate.pass ? "PASS" : "FAIL"}
                </span>
              )),
            )}
          </div>
          {emitted.warnings.length > 0 && (
            <p style={s.note}>
              Emitter notes (every synthesis is recorded — nothing silent):{" "}
              {emitted.warnings.map((w) => w.code).join(", ")}
            </p>
          )}
        </section>
      )}

      {done && (
        <section style={s.card} data-testid="outcome">
          <h2 style={s.h2}>
            Outcome:{" "}
            <span style={{ color: done.outcome === "passed" ? "#16a34a" : "#b91c1c" }}>{done.outcome}</span>
          </h2>
          {rendered && (
            <div style={{ ...s.surfaceFrame, ...themeVars }} className="a2ui-surface" data-testid="rendered-surface">
              <MarkdownContext.Provider value={renderMarkdown}>
                <A2uiSurface surface={rendered} />
              </MarkdownContext.Provider>
            </div>
          )}
          <p style={s.note}>
            {rendered
              ? "Rendered off the generated catalog through @a2ui/react v0.9.1 — dspack tokens drive the theme."
              : "No surface rendered — the pipeline reports failure honestly instead of degrading."}
          </p>
          <button
            data-testid="download-report"
            style={s.runBtn}
            onClick={() => {
              const blob = new Blob([JSON.stringify(done.report, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "audit-report.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download audit report (v1)
          </button>
        </section>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, background: "#fff", marginBottom: 16 },
  h2: { fontSize: 16, marginTop: 0 },
  note: { fontSize: 12.5, color: "#64748b", lineHeight: 1.5 },
  dim: { color: "#64748b", fontWeight: 400, fontSize: 12.5 },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569", flex: 1, minWidth: 160 },
  input: { border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px", fontSize: 13, fontFamily: "inherit" },
  runBtn: { background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 },
  chip: { borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600 },
  chipPass: { background: "#dcfce7", color: "#166534" },
  chipFail: { background: "#fee2e2", color: "#991b1b" },
  chipSkip: { background: "#f1f5f9", color: "#64748b" },
  finding: { borderLeft: "3px solid #dc2626", padding: "6px 10px", margin: "6px 0", fontSize: 13, background: "#fafafa" },
  rationale: { color: "#64748b", fontSize: 12.5, marginTop: 2 },
  pre: { background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 11.5, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" },
  surfaceFrame: { border: "1px dashed #cbd5e1", borderRadius: 8, padding: 16, minHeight: 160, background: "#f8fafc", marginTop: 8 },
};
