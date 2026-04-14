import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { loadAuthWithoutExpiry, saveAuth, clearAuth } from "./session.js";
import "@xterm/xterm/css/xterm.css";

// ─── Toast notification system ────────────────────────────────────────────────

let _toastPush = null; // set by ToastProvider, callable from anywhere

export function toast(msg, type = "error") {
  if (_toastPush) _toastPush(msg, type);
  else console.error("[toast]", msg);
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    _toastPush = (msg, type) => {
      const id = Date.now() + Math.random();
      setToasts(t => [...t.slice(-4), { id, msg: String(msg), type }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
    };
    return () => { _toastPush = null; };
  }, []);

  return (
    <>
      {children}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
        {toasts.map(t => (
          <div key={t.id} onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} style={{
            background: t.type === "error" ? "#1a0a0a" : "#0a1a0a",
            border: `1px solid ${t.type === "error" ? "#f87171" : "#6ee7b7"}`,
            borderLeft: `4px solid ${t.type === "error" ? "#f87171" : "#6ee7b7"}`,
            borderRadius: 8, padding: "12px 16px", cursor: "pointer",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
            color: t.type === "error" ? "#f87171" : "#6ee7b7",
            boxShadow: "0 4px 24px #00000080",
            animation: "slideIn 0.15s ease",
          }}>
            <span style={{ opacity: 0.6, marginRight: 8 }}>{t.type === "error" ? "✗" : "✓"}</span>
            {t.msg}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROMPTS = {
  developer: `You are an expert developer working on a production codebase.

Your task:
1. Read .torch_handoff.md if it exists — it contains feedback from a previous fix round.
2. Explore the codebase — understand existing patterns, architecture, naming conventions.
3. Implement the feature described in the issue. Match existing code style exactly. Minimal, focused changes — do not over-engineer.
4. Do NOT write tests. The tester agent handles that.
5. Run '{lint_command}' — fix ALL warnings and errors before continuing.
6. Run '{test_command}' — all pre-existing tests must still pass. Fix any regressions you introduced. Do not delete tests to make them pass.
7. Stage only implementation files with 'git add .' (do not stage test files you did not touch).
8. Write .torch_handoff.md (it will not be committed) with the following sections:

## What was implemented
Describe the feature: what it does, the approach taken, key decisions made.

## Files changed
List every file added or modified, with a one-line note on what changed.

## Notes for the tester
Point out the most important behaviours to test, edge cases to consider, and any tricky logic paths.

Rules:
- Do NOT commit — only stage changes.
- Do not modify dependency files unless strictly necessary.
- Do not modify or delete existing tests.`,

  tester: `You are a senior QA engineer. Your job is to WRITE tests, not just run them.

Steps:
1. Read .torch_handoff.md — the developer wrote it for you. Understand what was implemented and what needs testing.
2. Run 'git diff --staged' to inspect the implementation in detail.
3. Write unit tests (and integration tests where appropriate) covering:
   - Every new function, method, or class introduced
   - The happy path for each new behaviour
   - Edge cases and boundary conditions called out in .torch_handoff.md
   - Error and failure scenarios
4. Follow existing test file structure and naming conventions exactly.
5. Stage all new/modified test files with 'git add .'.
6. Run '{lint_command}' — fix any lint issues in the test files you wrote.
7. Run '{test_command}' — all tests (old and new) must pass.
8. Update .torch_handoff.md by appending a new section:

## What the tester did
List the test files created/modified and what each covers.

## Notes for the reviewer
Highlight any areas where coverage is intentionally limited and why, or anything that deserves extra scrutiny in the review.

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "if failed: which tests are failing or missing, and why",
  "issues": ["specific issue 1", "specific issue 2"]
}

Return failed if: any test fails, you could not write meaningful tests, or critical paths are still untested.`,

  reviewer: `You are a senior software architect doing a code review.

Steps:
1. Read .torch_handoff.md — it summarises what the developer implemented and what the tester verified. Use it as context for your review.
2. Run 'git diff --staged' to see all staged changes (implementation + tests).
3. Review for:
   - Correctness: does the implementation fully satisfy the issue requirements?
   - Code quality: naming, clarity, duplication, dead code
   - Architecture: does it fit existing patterns? No unnecessary abstractions
   - Security: input validation, error handling, no sensitive data leaked
   - Test coverage: are the important paths tested?
4. Verify naming conventions and code style match the existing codebase.

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "required changes if failed, empty string if success",
  "comments": ["observation 1", "observation 2"]
}

Be constructive but strict. Return failed if there are correctness issues, architectural problems, security concerns, or missing requirements. Minor style nits alone are not grounds for failure.`,

};

const DEFAULT_ARGS = {
  claude: {
    developer: ["--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep", "--max-turns", "40"],
    tester:    ["--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"],
    reviewer:  ["--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"],
    },
  opencode: {
    developer: ["run"],
    tester:    ["run"],
    reviewer:  ["run"],
  },
};

const AGENT_META = {
  developer: { icon: "⌨", label: "Developer", color: "#f59e0b", desc: "Implements the feature from the issue" },
  tester:    { icon: "⬡", label: "Tester",    color: "#6ee7b7", desc: "Runs tests and checks coverage" },
  reviewer:  { icon: "◈", label: "Reviewer",  color: "#f97316", desc: "Reviews code quality and architecture" },
};

const defaultAgent = (role) => ({
  cli: "claude", api_key: "", base_url: "", model: "",
  args: DEFAULT_ARGS.claude[role] ?? ["--print", "--dangerously-skip-permissions", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "30"],
  system_prompt: DEFAULT_PROMPTS[role] ?? "",
  max_fix_rounds: 3,
});

const emptyConfig = () => ({
  pipeline: { workspaces_dir: "/workspaces", max_fix_rounds: 3, test_command: "flutter test", lint_command: "flutter analyze", active: false },
  github:   { token: "", webhook_secret: "", trigger_label: "ai-implement", base_branch: "main" },
  agents:   { developer: defaultAgent("developer"), tester: defaultAgent("tester"), reviewer: defaultAgent("reviewer") },
});

// ─── API ──────────────────────────────────────────────────────────────────────

function authHeaders() {
  try {
    const stored = localStorage.getItem("torch_auth");
    if (!stored) return {};
    const { token } = JSON.parse(stored);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

async function apiFetch(url, options = {}) {
  const headers = { ...authHeaders(), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  return res;
}

const api = {
  getConfig:    () => apiFetch("/api/config").then(r => r.json()),
  saveConfig:   (cfg) => apiFetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).then(r => r.json()),
  getStatus:    () => apiFetch("/api/status").then(r => r.json()),
  start:        () => apiFetch("/api/pipeline/start",  { method: "POST" }).then(r => r.json()),
  stop:         () => apiFetch("/api/pipeline/stop",   { method: "POST" }).then(r => r.json()),
  listIssues:   (repo) => apiFetch(`/api/issues?repo=${encodeURIComponent(repo)}`).then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e.error)); return r.json(); }),
  triggerIssue: (body) => apiFetch("/api/pipeline/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  getLiveLog:   (issue) => apiFetch(`/api/live-log?issue=${issue}`).then(r => r.json()),
  listRepos:    () => apiFetch("/api/repos").then(r => r.json()),
  adminStats:   () => apiFetch("/api/admin/stats").then(r => r.json()),
  adminUsers:   () => apiFetch("/api/admin/users").then(r => r.json()),
  adminRuns:    () => apiFetch("/api/admin/runs").then(r => r.json()),
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const mono = "'JetBrains Mono', monospace";
const sans = "'Inter', sans-serif";

const colors = {
  bg: "#12100e", surface: "#1c1814", input: "#0f0d0b",
  border: "#2e2720", borderHover: "#ffffff28",
  text: "#f0ebe4", muted: "#7a6a5e", dim: "#4a3f38",
  cyan: "#f59e0b", green: "#6ee7b7", orange: "#f97316", red: "#f87171",
  white: "#fff",
};

// ─── Primitives ───────────────────────────────────────────────────────────────

function Field({ label, value, onChange, type = "text", placeholder, isCode = false, rows, hint, disabled }) {
  const base = {
    width: "100%", background: colors.input, border: `1px solid ${colors.border}`,
    borderRadius: 6, padding: "10px 14px", color: colors.text,
    fontSize: isCode ? 13 : 15, fontFamily: isCode ? mono : sans,
    outline: "none", boxSizing: "border-box", transition: "border-color 0.15s",
    resize: rows ? "vertical" : undefined,
    opacity: disabled ? 0.5 : 1,
  };
  const onFocus = (e) => (e.target.style.borderColor = colors.borderHover);
  const onBlur  = (e) => (e.target.style.borderColor = colors.border);
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", marginBottom: 6, fontFamily: mono }}>{label}</label>
      {rows
        ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder} style={base} onFocus={onFocus} onBlur={onBlur} disabled={disabled} />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={base} onFocus={onFocus} onBlur={onBlur} disabled={disabled} />
      }
      {hint && <p style={{ margin: "5px 0 0", fontSize: 12, color: colors.dim, fontFamily: mono }}>{hint}</p>}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", background: colors.input, borderRadius: 6, padding: 3, gap: 2, border: `1px solid ${colors.border}` }}>
      {["claude", "opencode"].map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: "6px 16px", borderRadius: 4, border: "none", cursor: "pointer",
          fontFamily: mono, fontSize: 13, fontWeight: 600,
          background: value === opt ? "#ffffff15" : "transparent",
          color: value === opt ? colors.white : colors.muted,
          boxShadow: value === opt ? "0 0 0 1px #ffffff22" : "none",
          transition: "all 0.15s",
        }}>{opt}</button>
      ))}
    </div>
  );
}

function Pill({ n, active, color, onClick }) {
  return (
    <button onClick={() => onClick(n)} style={{
      width: 38, height: 38, borderRadius: 6, cursor: "pointer",
      background: active ? `${color}22` : colors.input,
      border: `1px solid ${active ? color : colors.border}`,
      color: active ? color : colors.muted,
      fontFamily: mono, fontSize: 14, fontWeight: 700, transition: "all 0.15s",
    }}>{n}</button>
  );
}

function Btn({ children, onClick, variant = "default", disabled, style: s }) {
  const base = {
    padding: "11px 24px", borderRadius: 8, border: "1px solid",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.05em",
    transition: "all 0.2s", opacity: disabled ? 0.5 : 1, ...s,
  };
  const variants = {
    default: { background: "#ffffff0a", borderColor: "#ffffff22", color: colors.white },
    primary: { background: `${colors.green}22`, borderColor: colors.green, color: colors.green },
    danger:  { background: `${colors.red}22`,   borderColor: colors.red,   color: colors.red },
    ghost:   { background: "transparent",        borderColor: colors.border, color: colors.muted },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>;
}

function StatCard({ label, value, color = colors.cyan, sub }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderTop: `2px solid ${color}`, borderRadius: 10, padding: "20px 24px",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 50, background: `radial-gradient(ellipse at 50% -30%, ${color}18 0%, transparent 70%)`, pointerEvents: "none" }} />
      <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 36, fontWeight: 800, color, fontFamily: mono, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ margin: "6px 0 0", fontSize: 12, color: colors.muted, fontFamily: mono }}>{sub}</p>}
    </div>
  );
}

// ─── Agent card (compact for wizard) ─────────────────────────────────────────

function AgentCard({ role, config, onChange }) {
  const meta = AGENT_META[role];
  const [promptOpen, setPromptOpen] = useState(false);
  const set = (key, val) => onChange({ ...config, [key]: val });
  const handleCliChange = (cli) => onChange({ ...config, cli, args: DEFAULT_ARGS[cli][role] });

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderTop: `2px solid ${meta.color}`, borderRadius: 10, padding: 22, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 50, background: `radial-gradient(ellipse at 50% -20%, ${meta.color}18 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>{meta.icon}</span>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.white, fontFamily: sans }}>{meta.label}</p>
            <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: mono }}>{meta.desc}</p>
          </div>
        </div>
        <Toggle value={config.cli} onChange={handleCliChange} />
      </div>
      {config.cli === "claude" && (
        <>
          <div style={{ padding: "12px 16px", background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6, marginBottom: 16 }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>Local setup (recommended)</p>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: colors.text, fontFamily: mono, lineHeight: 1.8 }}>
              Torch mounts <span style={{ color: colors.cyan }}>~/.claude</span> from your machine into the container — no token needed.
            </p>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>One-time setup</p>
            <p style={{ margin: 0, fontSize: 13, color: colors.text, fontFamily: mono, lineHeight: 1.8 }}>
              1. Install Claude Code: <span style={{ color: colors.cyan }}>npm i -g @anthropic-ai/claude-code</span><br />
              2. Log in: run <span style={{ color: colors.cyan }}>claude</span> and complete the browser login<br />
              3. Restart the container — session is picked up automatically
            </p>
          </div>
          <Field
            label="OAuth Token (remote servers only)"
            value={config.api_key || ""}
            onChange={v => set("api_key", v)}
            type="password"
            placeholder="oc-ant-..."
            hint="Leave empty if running locally. For remote servers without ~/.claude, generate with: claude setup-token"
            isCode
          />
        </>
      )}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <label style={{ fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", fontFamily: mono }}>System Prompt</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { set("system_prompt", DEFAULT_PROMPTS[role]); setPromptOpen(true); }} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 12, fontFamily: mono }}>reset</button>
            <button onClick={() => setPromptOpen(o => !o)} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 12, fontFamily: mono }}>
              {promptOpen ? "collapse" : "expand"}
            </button>
          </div>
        </div>
        {promptOpen
          ? <textarea value={config.system_prompt || ""} onChange={e => set("system_prompt", e.target.value)} rows={10}
              style={{ width: "100%", background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "10px 14px", color: colors.text, fontSize: 13, fontFamily: mono, outline: "none", boxSizing: "border-box", resize: "vertical" }}
              onFocus={e => (e.target.style.borderColor = colors.borderHover)} onBlur={e => (e.target.style.borderColor = colors.border)} />
          : <div onClick={() => setPromptOpen(true)} style={{ background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "10px 14px", color: colors.dim, fontSize: 13, fontFamily: mono, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {(config.system_prompt || "").split("\n")[0]}…
            </div>
        }
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", fontFamily: mono, display: "block", marginBottom: 8 }}>Max Fix Rounds</label>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3, 4, 5].map(n => <Pill key={n} n={n} active={config.max_fix_rounds === n} color={meta.color} onClick={n => set("max_fix_rounds", n)} />)}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", fontFamily: mono, display: "block", marginBottom: 8 }}>Timeout (seconds)</label>
          <input
            type="number"
            value={config.timeout_secs || 1800}
            onChange={e => set("timeout_secs", parseInt(e.target.value) || 1800)}
            style={{ width: "100%", background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "8px 12px", color: colors.text, fontSize: 13, fontFamily: mono, outline: "none", boxSizing: "border-box" }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Setup wizard ─────────────────────────────────────────────────────────────

const STEPS = [
  { id: "agents",   label: "Agents",   icon: "⌨" },
  { id: "github",   label: "GitHub",   icon: "🔑" },
  { id: "pipeline", label: "Pipeline", icon: "⚙" },
  { id: "launch",   label: "Launch",   icon: "▶" },
];

function StepIndicator({ current, onGoTo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 36 }}>
      {STEPS.map((s, i) => {
        const done    = i < current;
        const active  = i === current;
        const pending = i > current;
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center" }}>
            <div
              onClick={() => done && onGoTo(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 16px", borderRadius: 8,
                background: active ? `${colors.cyan}22` : done ? `${colors.green}15` : "transparent",
                border: `1px solid ${active ? colors.cyan : done ? colors.green : colors.border}`,
                cursor: done ? "pointer" : "default",
              }}>
              <span style={{ fontSize: 14, opacity: pending ? 0.3 : 1 }}>{s.icon}</span>
              <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: active ? colors.cyan : done ? colors.green : colors.muted }}>
                {s.label}
              </span>
              {done && <span style={{ fontSize: 13, color: colors.green }}>✓</span>}
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ width: 24, height: 1, background: done ? colors.green : colors.border, margin: "0 4px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SetupWizard({ config, setConfig, onLaunch, launching, onLogout, auth }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const setAgent    = (role) => (val) => setConfig(c => ({ ...c, agents: { ...c.agents, [role]: val } }));
  const setGithub   = (key)  => (val) => setConfig(c => ({ ...c, github:   { ...c.github,   [key]: val } }));
  const setPipeline = (key)  => (val) => setConfig(c => ({ ...c, pipeline: { ...c.pipeline, [key]: val } }));

  const saveAndNext = async () => {
    setSaving(true);
    try { await api.saveConfig(config); } catch (e) { toast(e?.message ?? "Save failed"); }
    setSaving(false);
    setStep(s => s + 1);
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: sans, padding: "40px 28px" }}>
      <div style={{ maxWidth: 1020, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src="/logo-48.png" alt="Torch" style={{ width: 48, height: 48, borderRadius: 12 }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors.orange, boxShadow: `0 0 8px ${colors.orange}` }} />
                <span style={{ fontSize: 12, letterSpacing: "0.2em", color: colors.orange, textTransform: "uppercase", fontFamily: mono }}>setup</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: colors.white, letterSpacing: "-0.02em" }}>Torch</h1>
              <p style={{ margin: "4px 0 0", fontSize: 14, color: colors.muted, fontFamily: mono }}>Configure your agents and connect GitHub to get started.</p>
            </div>
          </div>
          <Btn variant="ghost" onClick={onLogout}>Logout</Btn>
        </div>

        <StepIndicator current={step} onGoTo={setStep} />

        {/* Step 0 — Agents */}
        {step === 0 && (
          <div>
            <SectionTitle>Configure AI Agents</SectionTitle>
            <p style={{ marginBottom: 24, fontSize: 14, color: colors.muted, fontFamily: mono }}>
              Choose the AI CLI and set API keys for each agent role.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28 }}>
              {["developer", "tester", "reviewer"].map(role => (
                <AgentCard key={role} role={role} config={config.agents[role]} onChange={setAgent(role)} />
              ))}
            </div>
            {Object.values(config.agents).some(a => a.cli === "opencode") && (
              <Card style={{ marginBottom: 28 }}>
                <CardTitle icon="{}">Opencode Config</CardTitle>
                <p style={{ margin: "-4px 0 16px", fontSize: 13, color: colors.muted, fontFamily: mono }}>
                  At least one agent uses <span style={{ color: colors.cyan }}>opencode</span>. Paste your <span style={{ color: colors.cyan }}>opencode.json</span> here — it will be injected into every workspace before agents run. <span style={{ color: colors.dim }}>permission.* = allow is added automatically.</span>
                </p>
                <Field
                  label="opencode.json"
                  value={config.pipeline.opencode_config || ""}
                  onChange={setPipeline("opencode_config")}
                  rows={8}
                  isCode
                  placeholder={'{\n  "provider": {\n    "name": "openai",\n    "apiKey": "sk-..."\n  },\n  "model": "gpt-4o"\n}'}
                />
              </Card>
            )}
            <StepNav onNext={saveAndNext} saving={saving} />
          </div>
        )}

        {/* Step 1 — GitHub */}
        {step === 1 && (
          <div style={{ maxWidth: 580 }}>
            <SectionTitle>Connect GitHub</SectionTitle>
            <p style={{ marginBottom: 24, fontSize: 14, color: colors.muted, fontFamily: mono }}>
              Provide a fine-grained token with access to the target repository.
            </p>

            <Card accent={colors.cyan}>
              <CardTitle icon="🔑">GitHub Token</CardTitle>
              <p style={{ margin: "0 0 18px", fontSize: 13, color: colors.muted, fontFamily: mono }}>Fine-grained personal access token — clone, push, PR, labels</p>
              <Field label="Token" value={config.github.token} onChange={setGithub("token")} type="password" placeholder="ghp_..." isCode />
              <div style={{ padding: "16px 18px", background: colors.input, borderRadius: 8, border: `1px solid ${colors.border}`, marginBottom: 14 }}>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>Required repository permissions</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                  {[["Contents", "Read & write", "clone + push"], ["Pull requests", "Read & write", "opens the PR"], ["Issues", "Read & write", "labels + comments + create"], ["Metadata", "Read", "required + repo listing"]].map(([scope, level, note]) => (
                    <div key={scope} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 12, color: colors.green, fontFamily: mono }}>✓</span>
                      <div>
                        <span style={{ fontSize: 13, color: colors.text, fontFamily: mono }}>{scope}</span>
                        <span style={{ fontSize: 12, color: colors.muted, fontFamily: mono }}> · {level}</span>
                        <div style={{ fontSize: 12, color: colors.dim, fontFamily: mono }}>{note}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 12, color: colors.dim, fontFamily: mono }}>
                  Fine-grained PAT: set <span style={{ color: colors.text }}>Repository access → All repositories</span> to enable the terminal repo picker.
                </p>
              </div>
            </Card>

            <Card style={{ marginTop: 16 }}>
              <CardTitle icon="⚡">Webhook</CardTitle>
              <p style={{ margin: "-4px 0 16px", fontSize: 13, color: colors.muted, fontFamily: mono }}>
                GitHub calls this URL when an issue is labeled. Each user has a unique URL tied to their account.
              </p>

              {/* Step-by-step guide */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                {[
                  {
                    n: "1",
                    title: "Go to your repository on GitHub",
                    body: <span>Open <span style={{ color: colors.cyan }}>Settings → Webhooks → Add webhook</span></span>,
                  },
                  {
                    n: "2",
                    title: "Set the Payload URL",
                    body: (
                      <div>
                        <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.muted, fontFamily: mono }}>Copy this URL — it is unique to your account:</p>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "8px 12px" }}>
                          <span style={{ flex: 1, fontSize: 13, color: colors.cyan, fontFamily: mono, wordBreak: "break-all" }}>
                            {window.location.origin}/webhook/github/{auth?.sub ?? "…"}
                          </span>
                          <button
                            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/webhook/github/${auth?.sub ?? ""}`)}
                            style={{ flexShrink: 0, background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 12, fontFamily: mono }}
                          >copy</button>
                        </div>
                      </div>
                    ),
                  },
                  {
                    n: "3",
                    title: "Content type",
                    body: <span>Set to <span style={{ color: colors.text, fontFamily: mono }}>application/json</span></span>,
                  },
                  {
                    n: "4",
                    title: "Choose a webhook secret",
                    body: <span>Generate a random string (e.g. <span style={{ color: colors.text, fontFamily: mono }}>openssl rand -hex 32</span>), paste it below <em>and</em> in GitHub.</span>,
                  },
                  {
                    n: "5",
                    title: "Select events",
                    body: <span>Choose <span style={{ color: colors.text }}>Let me select individual events</span> → tick <span style={{ color: colors.text }}>Issues</span> only.</span>,
                  },
                  {
                    n: "6",
                    title: "Save",
                    body: <span>Click <span style={{ color: colors.text }}>Add webhook</span>. GitHub will send a ping — a ✓ means Torch is reachable.</span>,
                  },
                ].map(({ n, title, body }) => (
                  <div key={n} style={{ display: "flex", gap: 14 }}>
                    <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: "50%", background: `${colors.cyan}22`, border: `1px solid ${colors.cyan}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: colors.cyan, fontFamily: mono, fontWeight: 700 }}>{n}</div>
                    <div style={{ paddingTop: 2 }}>
                      <p style={{ margin: "0 0 4px", fontSize: 13, color: colors.text, fontFamily: mono, fontWeight: 600 }}>{title}</p>
                      <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: mono, lineHeight: 1.7 }}>{body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Field label="Webhook Secret" value={config.github.webhook_secret} onChange={setGithub("webhook_secret")} type="password" placeholder="openssl rand -hex 32" isCode hint="Must match exactly what you entered in GitHub." />
            </Card>

            <div style={{ marginTop: 28 }}>
              <StepNav onBack={() => setStep(s => s - 1)} onNext={saveAndNext} saving={saving} />
            </div>
          </div>
        )}

        {/* Step 2 — Pipeline */}
        {step === 2 && (
          <div style={{ maxWidth: 580 }}>
            <SectionTitle>Pipeline Settings</SectionTitle>
            <p style={{ marginBottom: 24, fontSize: 14, color: colors.muted, fontFamily: mono }}>
              Set the trigger label and the commands agents will run to test your codebase.
            </p>

            <Card>
              <CardTitle icon="⚙">Trigger & Branch</CardTitle>
              <Field label="Trigger Label" value={config.github.trigger_label} onChange={setGithub("trigger_label")} placeholder="ai-implement" isCode />
              <Field label="Base Branch" value={config.github.base_branch} onChange={setGithub("base_branch")} placeholder="main" isCode />
              <Field label="Workspaces Dir" value={config.pipeline.workspaces_dir} onChange={setPipeline("workspaces_dir")} placeholder="/workspaces" isCode />
            </Card>

            <Card style={{ marginTop: 16 }}>
              <CardTitle icon="🧪">Test Commands</CardTitle>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: colors.muted, fontFamily: mono }}>
                These replace <span style={{ color: colors.cyan }}>{"{test_command}"}</span> and <span style={{ color: colors.cyan }}>{"{lint_command}"}</span> in agent prompts.
              </p>
              <Field label="Test Command" value={config.pipeline.test_command || ""} onChange={setPipeline("test_command")} placeholder="flutter test" isCode />
              <Field label="Lint Command" value={config.pipeline.lint_command || ""} onChange={setPipeline("lint_command")} placeholder="flutter analyze" isCode />

              <div style={{ padding: "12px 16px", background: colors.input, borderRadius: 6, border: `1px solid ${colors.border}` }}>
                <p style={{ margin: "0 0 6px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>Examples</p>
                {[
                  ["Flutter",  "flutter test",       "flutter analyze"],
                  ["Node.js",  "npm test",            "npm run lint"],
                  ["Python",   "pytest --tb=short",   "ruff check ."],
                  ["Go",       "go test ./...",       "go vet ./..."],
                ].map(([stack, test, lint]) => (
                  <div key={stack} style={{ display: "flex", gap: 12, marginBottom: 4, alignItems: "center" }}>
                    <span style={{ width: 60, fontSize: 12, color: colors.muted, fontFamily: mono }}>{stack}</span>
                    <span style={{ fontSize: 12, color: colors.dim, fontFamily: mono }}>{test} · {lint}</span>
                  </div>
                ))}
              </div>
            </Card>

            <div style={{ marginTop: 28 }}>
              <StepNav onBack={() => setStep(s => s - 1)} onNext={saveAndNext} saving={saving} />
            </div>
          </div>
        )}

        {/* Step 3 — Launch */}
        {step === 3 && (
          <div style={{ maxWidth: 560 }}>
            <SectionTitle>Ready to Launch</SectionTitle>
            <p style={{ marginBottom: 28, fontSize: 14, color: colors.muted, fontFamily: mono }}>
              Configuration saved. The pipeline will start listening for GitHub webhooks.
            </p>

            {/* Summary */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
                {[
                  ["Developer",     config.agents.developer.cli],
                  ["Tester",        config.agents.tester.cli],
                  ["Reviewer",      config.agents.reviewer.cli],
                  ["Trigger label", config.github.trigger_label],
                  ["Base branch",   config.github.base_branch],
                  ["Test command",  config.pipeline.test_command],
                  ["Lint command",  config.pipeline.lint_command],
                  ["Max rounds",    config.pipeline.max_fix_rounds],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>{k}</p>
                    <p style={{ margin: "3px 0 0", fontSize: 14, color: colors.text, fontFamily: mono }}>{String(v)}</p>
                  </div>
                ))}
              </div>
            </Card>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Btn variant="ghost" onClick={() => setStep(s => s - 1)}>← Back</Btn>
              <Btn variant="primary" onClick={onLaunch} disabled={launching} style={{ flex: 1, justifyContent: "center" }}>
                {launching ? "Launching..." : "▶ Launch Pipeline"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepNav({ onBack, onNext, saving }) {
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
      {onBack && <Btn variant="ghost" onClick={onBack}>← Back</Btn>}
      <Btn variant="default" onClick={onNext} disabled={saving}>{saving ? "Saving..." : "Next →"}</Btn>
    </div>
  );
}

// ─── Issues panel ────────────────────────────────────────────────────────────

function IssuesPanel({ triggerLabel, pipelineActive, config, setConfig }) {
  const savedRepos = config?.github?.repos ?? [];
  const [repo,     setRepo]     = useState(savedRepos[0] ?? "");
  const [issues,   setIssues]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [statuses, setStatuses] = useState({}); // { [number]: 'queued' | 'error' }

  const saveRepo = async (r) => {
    if (!r || savedRepos.includes(r)) return;
    const updated = { ...config, github: { ...config.github, repos: [...savedRepos, r] } };
    setConfig(updated);
    await api.saveConfig(updated).catch(e => toast(e?.message ?? "Save failed"));
  };

  const removeRepo = async (r) => {
    const updated = { ...config, github: { ...config.github, repos: savedRepos.filter(x => x !== r) } };
    setConfig(updated);
    await api.saveConfig(updated).catch(e => toast(e?.message ?? "Save failed"));
    if (repo === r) { setRepo(""); setIssues(null); }
  };

  const load = async (target) => {
    const r = (target ?? repo).trim();
    if (!r) return;
    setRepo(r);
    setLoading(true);
    setError(null);
    setStatuses({});
    try {
      const data = await api.listIssues(r);
      setIssues(data ?? []);
      await saveRepo(r);
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to load issues");
      setIssues(null);
    }
    setLoading(false);
  };

  const trigger = async (issue) => {
    setStatuses(s => ({ ...s, [issue.number]: "queuing" }));
    try {
      await api.triggerIssue({
        repo_full_name: repo.trim(),
        issue_number:   issue.number,
        issue_title:    issue.title,
        issue_body:     issue.body,
      });
      setStatuses(s => ({ ...s, [issue.number]: "queued" }));
    } catch {
      setStatuses(s => ({ ...s, [issue.number]: "error" }));
    }
  };

  return (
    <div>
      {/* Saved repos chips */}
      {savedRepos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {savedRepos.map(r => (
            <div key={r} style={{
              display: "flex", alignItems: "center", gap: 0,
              background: repo === r ? `${colors.cyan}22` : colors.surface,
              border: `1px solid ${repo === r ? colors.cyan : colors.border}`,
              borderRadius: 6, overflow: "hidden",
            }}>
              <button onClick={() => load(r)} style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "6px 12px", fontSize: 13, fontFamily: mono,
                color: repo === r ? colors.cyan : colors.muted,
              }}>{r}</button>
              <button onClick={() => removeRepo(r)} style={{
                background: "none", border: "none", borderLeft: `1px solid ${colors.border}`,
                cursor: "pointer", padding: "6px 8px", fontSize: 11,
                color: colors.muted, lineHeight: 1,
              }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Repo input */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <input
          value={repo}
          onChange={e => setRepo(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()}
          placeholder="owner/repo"
          style={{ flex: 1, background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "10px 14px", color: colors.text, fontSize: 14, fontFamily: mono, outline: "none" }}
          onFocus={e => (e.target.style.borderColor = colors.borderHover)}
          onBlur={e => (e.target.style.borderColor = colors.border)}
        />
        <Btn onClick={() => load()} disabled={loading || !repo.trim()}>
          {loading ? "Loading..." : "Load Issues"}
        </Btn>
      </div>

      {!pipelineActive && (
        <div style={{ padding: "12px 16px", background: `${colors.orange}11`, border: `1px solid ${colors.orange}44`, borderRadius: 8, marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.orange, fontFamily: mono }}>
            ⚠ Pipeline is stopped. Launch it first to trigger issues.
          </p>
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 16px", background: `${colors.red}11`, border: `1px solid ${colors.red}44`, borderRadius: 8, marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: colors.red, fontFamily: mono }}>{error}</p>
        </div>
      )}

      {issues !== null && issues.length === 0 && (
        <p style={{ color: colors.muted, fontFamily: mono, fontSize: 14, textAlign: "center", padding: "32px 0" }}>No open issues found.</p>
      )}

      {issues !== null && issues.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {issues.map(issue => {
            const st = statuses[issue.number];
            const hasLabel = issue.labels.includes(triggerLabel);
            return (
              <div key={issue.number} style={{
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderLeft: `3px solid ${hasLabel ? colors.green : colors.border}`,
                borderRadius: 8, padding: "16px 20px",
                display: "flex", alignItems: "flex-start", gap: 16,
              }}>
                {/* Issue number */}
                <span style={{ fontSize: 13, color: colors.muted, fontFamily: mono, minWidth: 36, paddingTop: 2 }}>#{issue.number}</span>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: colors.white, fontFamily: sans, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {issue.title}
                  </p>
                  {issue.body && (
                    <p style={{ margin: "0 0 8px", fontSize: 13, color: colors.muted, fontFamily: mono, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {issue.body}
                    </p>
                  )}
                  {issue.labels.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {issue.labels.map(l => (
                        <span key={l} style={{
                          fontSize: 11, fontFamily: mono, padding: "2px 8px", borderRadius: 4,
                          background: l === triggerLabel ? `${colors.green}22` : "#ffffff0a",
                          border: `1px solid ${l === triggerLabel ? colors.green : colors.border}`,
                          color: l === triggerLabel ? colors.green : colors.muted,
                        }}>{l}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action */}
                <div style={{ minWidth: 100, display: "flex", justifyContent: "flex-end" }}>
                  {st === "queued" ? (
                    <span style={{ fontSize: 13, color: colors.green, fontFamily: mono, padding: "8px 0" }}>✓ Queued</span>
                  ) : st === "error" ? (
                    <span style={{ fontSize: 13, color: colors.red, fontFamily: mono, padding: "8px 0" }}>✗ Error</span>
                  ) : (
                    <Btn
                      onClick={() => trigger(issue)}
                      disabled={!pipelineActive || st === "queuing"}
                      variant={hasLabel ? "primary" : "default"}
                      style={{ padding: "8px 16px" }}
                    >
                      {st === "queuing" ? "..." : "▶ Run"}
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Extra env editor ─────────────────────────────────────────────────────────

function ExtraEnvEditor({ value, onChange }) {
  const entries = Object.entries(value);
  const add    = () => onChange({ ...value, "": "" });
  const remove = (k) => { const n = { ...value }; delete n[k]; onChange(n); };
  const rename = (old, k) => { const n = {}; for (const [ek, ev] of Object.entries(value)) n[ek === old ? k : ek] = ev; onChange(n); };
  const setVal = (k, v) => onChange({ ...value, [k]: v });

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", fontFamily: mono }}>Agent Environment</label>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: colors.dim, fontFamily: mono }}>Injected into every agent process. Use <span style={{ color: colors.cyan }}>PATH</span> to expose SDK binaries mounted from the host (Flutter, Go, Python…).</p>
        </div>
        <button onClick={add} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 12, fontFamily: mono, flexShrink: 0 }}>+ add</button>
      </div>
      {entries.length === 0 && (
        <p style={{ fontSize: 12, color: colors.dim, fontFamily: mono, margin: 0 }}>e.g. <span style={{ color: colors.cyan }}>PATH</span> → <span style={{ color: colors.text }}>/opt/flutter/bin</span> · <span style={{ color: colors.text }}>/usr/local/go/bin</span> · <span style={{ color: colors.text }}>/root/.pyenv/shims</span></p>
      )}
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input value={k} onChange={e => rename(k, e.target.value)} placeholder="KEY" style={{ width: 140, background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 4, padding: "6px 10px", color: colors.cyan, fontSize: 12, fontFamily: mono, outline: "none", flexShrink: 0 }} />
          <input value={v} onChange={e => setVal(k, e.target.value)} placeholder="value" style={{ flex: 1, background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 4, padding: "6px 10px", color: colors.text, fontSize: 12, fontFamily: mono, outline: "none" }} />
          <button onClick={() => remove(k)} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.red, cursor: "pointer", padding: "6px 8px", fontSize: 12, fontFamily: mono, flexShrink: 0 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Live log panel ───────────────────────────────────────────────────────────

const LOG_COLORS = {
  text:   colors.text,
  tool:   colors.cyan,
  result: "#888",
  info:   colors.muted,
  error:  colors.red,
};

const LOG_ICONS = {
  text:   "▸",
  tool:   "⚙",
  result: "←",
  info:   "·",
  error:  "✗",
};

function LiveLogPanel({ runs }) {
  const liveRuns  = (runs ?? []).filter(r => r.status === "active" || r.status === "pending" || r.status === "retrying");
  const firstLive = liveRuns[0]?.issue_number ?? null;

  const [issue,   setIssue]   = useState(firstLive);
  const [lines,   setLines]   = useState([]);
  const scrollRef             = useRef(null);
  const pollRef               = useRef(null);
  const atBottomRef           = useRef(true);

  // Auto-select first live run when it appears
  useEffect(() => {
    if (firstLive && !issue) setIssue(firstLive);
  }, [firstLive]);

  useEffect(() => {
    clearInterval(pollRef.current);
    if (!issue) return;
    setLines([]);
    const fetch_ = () => api.getLiveLog(issue).then(setLines).catch(e => toast(e?.message ?? "Live log fetch failed"));
    fetch_();
    pollRef.current = setInterval(fetch_, 1000);
    return () => clearInterval(pollRef.current);
  }, [issue]);

  useEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const selectedRun = (runs ?? []).find(r => r.issue_number === issue);
  const isLive = selectedRun && ["active", "pending", "retrying"].includes(selectedRun.status);

  return (
    <div style={{ background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: isLive ? colors.green : colors.muted, boxShadow: isLive ? `0 0 6px ${colors.green}` : "none", animation: isLive ? "pulse 1.5s infinite" : "none" }} />
          <span style={{ fontFamily: mono, fontSize: 12, color: colors.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {issue ? `live · issue #${issue}` : "live log"}
          </span>
        </div>
        <span style={{ fontFamily: mono, fontSize: 11, color: colors.dim }}>{lines.length} lines</span>
      </div>

      {/* Issue selector — only in-progress runs */}
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${colors.border}` }}>
        {liveRuns.length === 0 ? (
          <span style={{ fontFamily: mono, fontSize: 12, color: colors.dim }}>no active runs</span>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {liveRuns.map(r => (
              <button key={r.id} onClick={() => setIssue(r.issue_number)} style={{
                padding: "4px 12px", borderRadius: 6, border: `1px solid ${issue === r.issue_number ? colors.orange : colors.border}`,
                background: issue === r.issue_number ? `${colors.orange}18` : "transparent",
                color: issue === r.issue_number ? colors.orange : colors.muted,
                fontFamily: mono, fontSize: 12, cursor: "pointer",
              }}>
                #{r.issue_number} {r.issue_title ? `· ${r.issue_title.slice(0, 30)}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Log lines */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ height: 360, overflowY: "auto", padding: "10px 0", fontFamily: mono, fontSize: 12 }}
      >
        {lines.length === 0 && (
          <p style={{ color: colors.dim, textAlign: "center", padding: "40px 0", margin: 0 }}>waiting for agent output…</p>
        )}
        {lines.filter(l => l.content?.trim()).map((l, i) => {
          const col  = LOG_COLORS[l.type] ?? colors.muted;
          const icon = LOG_ICONS[l.type]  ?? "·";
          const time = new Date(l.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          return (
            <div key={i} style={{ display: "flex", gap: 10, padding: "2px 16px", alignItems: "flex-start", borderBottom: l.type === "text" ? `1px solid ${colors.border}22` : "none" }}>
              <span style={{ color: colors.dim, minWidth: 60, flexShrink: 0 }}>{time}</span>
              <span style={{ color: colors.muted, minWidth: 70, flexShrink: 0, fontSize: 11 }}>{l.role}</span>
              <span style={{ color: col, minWidth: 14, flexShrink: 0 }}>{icon}</span>
              <span style={{ color: col, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, flex: 1 }}>{l.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Runs list ────────────────────────────────────────────────────────────────

const STATUS_META = {
  active:    { icon: "◌", color: colors.orange, label: "active" },
  pending:   { icon: "○", color: colors.cyan,   label: "pending" },
  retrying:  { icon: "↺", color: colors.orange, label: "retrying" },
  completed: { icon: "✓", color: colors.green,  label: "completed" },
  failed:    { icon: "✗", color: colors.red,    label: "failed" },
};

function RunsList({ runs }) {
  const [expanded, setExpanded] = useState({});

  if (!runs || runs.length === 0) {
    return (
      <p style={{ color: colors.muted, fontFamily: mono, fontSize: 13, textAlign: "center", padding: "28px 0" }}>
        No runs yet. Trigger an issue or wait for a webhook.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {runs.map(run => {
        const meta   = STATUS_META[run.status] ?? STATUS_META.pending;
        const ts     = run.completed_at ?? run.failed_at;
        const isOpen = expanded[run.id];

        return (
          <div key={run.id} style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${meta.color}`,
            borderRadius: 8, padding: "14px 18px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Status icon */}
              <span style={{
                fontSize: 15, color: meta.color, fontFamily: mono, minWidth: 16, textAlign: "center",
                animation: run.status === "active" ? "pulse 1.5s infinite" : undefined,
              }}>
                {meta.icon}
              </span>

              {/* Issue info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, color: colors.muted, fontFamily: mono }}>#{run.issue_number}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.white, fontFamily: sans, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {run.issue_title || "(no title)"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: colors.dim, fontFamily: mono }}>{run.repo}</span>
                  {ts && (
                    <span style={{ fontSize: 12, color: colors.dim, fontFamily: mono }}>
                      {new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              </div>

              {/* Status badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 11, fontFamily: mono, padding: "3px 10px", borderRadius: 4,
                  background: `${meta.color}18`, border: `1px solid ${meta.color}44`,
                  color: meta.color, letterSpacing: "0.05em",
                }}>
                  {meta.label}
                </span>
                {run.error && (
                  <button
                    onClick={() => setExpanded(e => ({ ...e, [run.id]: !e[run.id] }))}
                    style={{
                      background: "none", border: `1px solid ${colors.border}`, borderRadius: 4,
                      color: colors.muted, cursor: "pointer", padding: "3px 8px",
                      fontSize: 11, fontFamily: mono,
                    }}
                  >
                    {isOpen ? "hide" : "details"}
                  </button>
                )}
              </div>
            </div>

            {/* Error detail */}
            {isOpen && run.error && (
              <div style={{
                marginTop: 12, padding: "12px 14px",
                background: `${colors.red}0a`, border: `1px solid ${colors.red}33`,
                borderRadius: 6, fontFamily: mono, fontSize: 12, color: colors.red,
                whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7,
              }}>
                {run.error}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Terminal panel ───────────────────────────────────────────────────────────

// Key sequences sent by the mobile toolbar
const TOOLBAR_KEYS = [
  { label: "Tab",    seq: "\t" },
  { label: "↑",      seq: "\x1b[A" },
  { label: "↓",      seq: "\x1b[B" },
  { label: "←",      seq: "\x1b[D" },
  { label: "→",      seq: "\x1b[C" },
  { label: "Ctrl+C", seq: "\x03" },
  { label: "Ctrl+D", seq: "\x04" },
];

// TerminalSession: PTY over WebSocket with fullscreen, key toolbar, auto-reconnect.
function TerminalSession({ auth, repo, onDisconnect }) {
  const containerRef  = useRef(null);
  const wrapperRef    = useRef(null);
  const fitRef        = useRef(null);
  const termRef       = useRef(null);
  const wsRef         = useRef(null);
  const manualClose   = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // In fullscreen: follow the visual viewport so the toolbar stays above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!isFullscreen || !vv) return;
    const update = () => {
      const el = wrapperRef.current;
      if (!el) return;
      el.style.top    = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      fitRef.current?.fit();
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, [isFullscreen]);

  // Refit terminal after fullscreen toggle.
  useEffect(() => {
    const t = setTimeout(() => fitRef.current?.fit(), 60);
    return () => clearTimeout(t);
  }, [isFullscreen]);

  // Send raw bytes to the PTY.
  const sendSeq = (seq) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(new TextEncoder().encode(seq));
  };

  const handlePaste = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) sendSeq(t); } catch {}
  };

  // Connect (or reconnect) to the PTY WebSocket.
  useLayoutEffect(() => {
    let term, fitAddon;
    let reconnectTimer = null;
    let reconnectDelay = 1000;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const token = auth?.token ?? "";
      if (!token) { termRef.current?.writeln("\x1b[31m[no auth token — please log in again]\x1b[0m"); return; }

      fetch("/api/status", { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          if (cancelled) return;
          if (res.status === 401) { termRef.current?.writeln("\x1b[31m[session expired — please log in again]\x1b[0m"); return; }

          const proto    = location.protocol === "https:" ? "wss:" : "ws:";
          const repoParam = repo ? `&repo=${encodeURIComponent(repo)}` : "";
          const ws = new WebSocket(`${proto}//${location.host}/ws/terminal?token=${encodeURIComponent(token)}${repoParam}`);
          wsRef.current = ws;
          ws.binaryType = "arraybuffer";

          ws.onopen = () => {
            reconnectDelay = 1000; // reset backoff on success
            const t = termRef.current;
            if (t) ws.send(JSON.stringify({ type: "resize", rows: t.rows, cols: t.cols }));
          };
          ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) termRef.current?.write(new Uint8Array(e.data)); };
          ws.onerror   = () => { if (!cancelled) termRef.current?.writeln("\r\n\x1b[31m[connection error]\x1b[0m"); };
          ws.onclose   = () => {
            wsRef.current = null;
            if (cancelled || manualClose.current) {
              termRef.current?.writeln("\r\n\x1b[33m[session ended]\x1b[0m");
              return;
            }
            // Auto-reconnect with exponential backoff (max 30s)
            const delay = reconnectDelay;
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            termRef.current?.writeln(`\r\n\x1b[33m[disconnected — reconnecting in ${Math.round(delay / 1000)}s…]\x1b[0m`);
            reconnectTimer = setTimeout(connect, delay);
          };
        })
        .catch(() => { if (!cancelled) termRef.current?.writeln("\x1b[31m[cannot reach backend]\x1b[0m"); });
    };

    Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      .then(([{ Terminal }, { FitAddon }]) => {
        if (cancelled) return;
        term = new Terminal({
          cursorBlink: true, fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          theme: {
            background: "#12100e", foreground: "#f0ebe4", cursor: "#f59e0b",
            selectionBackground: "#f59e0b40",
            black: "#12100e", brightBlack: "#4a3f38",
            red: "#f87171", brightRed: "#fca5a5", green: "#6ee7b7", brightGreen: "#a7f3d0",
            yellow: "#f59e0b", brightYellow: "#fcd34d", blue: "#60a5fa", brightBlue: "#93c5fd",
            magenta: "#a78bfa", brightMagenta: "#c4b5fd", cyan: "#22d3ee", brightCyan: "#67e8f9",
            white: "#f0ebe4", brightWhite: "#ffffff",
          },
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitRef.current = fitAddon;
        termRef.current = term;

        if (containerRef.current) { term.open(containerRef.current); fitAddon.fit(); }

        // Input handlers reference wsRef so they survive reconnects without re-registering.
        term.onData(data => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(new TextEncoder().encode(data)); });
        term.onResize(({ rows, cols }) => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "resize", rows, cols })); });

        const onWinResize = () => fitAddon?.fit();
        window.addEventListener("resize", onWinResize);
        connect();

        // cleanup returns a function — handled by outer return below
        return () => window.removeEventListener("resize", onWinResize);
      });

    return () => {
      cancelled = true;
      manualClose.current = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      term?.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const titleLabel = repo ? `groom — ${repo}` : "bash — /workspaces";

  const wrapperStyle = isFullscreen
    ? { position: "fixed", left: 0, right: 0, top: 0, height: "100dvh", zIndex: 9999,
        display: "flex", flexDirection: "column", background: "#12100e" }
    : { display: "flex", flexDirection: "column", background: "#12100e",
        borderRadius: 10, border: `1px solid ${colors.border}`, overflow: "hidden" };

  const btnSm  = { background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 11, fontFamily: mono };
  const keyBtn = { background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.text, cursor: "pointer", padding: "9px 14px", fontFamily: mono, fontSize: 13, flexShrink: 0, userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation" };

  return (
    <div ref={wrapperRef} style={wrapperStyle}>

      {/* ── Titlebar ─────────────────────────────── */}
      <div style={{ padding: "10px 16px", background: colors.surface, borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["#f87171","#f59e0b","#6ee7b7"].map(c => <div key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />)}
          </div>
          <span style={{ fontSize: 12, color: colors.muted, fontFamily: mono }}>{titleLabel}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setIsFullscreen(f => !f)} style={btnSm}>
            {isFullscreen ? "⊡ exit" : "⊞ full"}
          </button>
          <button onClick={() => { manualClose.current = true; onDisconnect(); }} style={btnSm}>
            ✕ close
          </button>
        </div>
      </div>

      {/* ── xterm container ───────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, minHeight: isFullscreen ? 0 : 320, overflow: "hidden" }} />

      {/* ── Key toolbar ───────────────────────────── */}
      {/* onPointerDown + preventDefault keeps focus (and keyboard) in the terminal */}
      <div style={{ background: colors.surface, borderTop: `1px solid ${colors.border}`, display: "flex", gap: 6, padding: "8px 10px", overflowX: "auto", flexShrink: 0, WebkitOverflowScrolling: "touch" }}>
        {TOOLBAR_KEYS.map(({ label, seq }) => (
          <button key={label} onPointerDown={e => { e.preventDefault(); sendSeq(seq); }} style={keyBtn}>
            {label}
          </button>
        ))}
        <button onPointerDown={e => { e.preventDefault(); handlePaste(); }} style={{ ...keyBtn, color: colors.cyan, marginLeft: "auto" }}>
          paste
        </button>
      </div>

    </div>
  );
}

// TerminalPanel shows a repo picker, then opens the terminal session.
function TerminalPanel({ auth }) {
  const [activeRepo, setActive] = useState(null); // null = picker

  if (activeRepo !== null) {
    return (
      <TerminalSession
        auth={auth}
        repo={activeRepo || undefined}
        onDisconnect={() => setActive(null)}
      />
    );
  }

  return <RepoPicker onSelect={setActive} />;
}

function RepoPicker({ onSelect }) {
  const [repos,   setRepos]   = useState(null);  // null = loading
  const [error,   setError]   = useState(null);
  const [filter,  setFilter]  = useState("");
  const [custom,  setCustom]  = useState("");

  useEffect(() => {
    api.listRepos()
      .then(setRepos)
      .catch(err => setError(err?.message ?? "Could not load repos"));
  }, []);

  const filtered = (repos ?? []).filter(r =>
    r.toLowerCase().includes(filter.toLowerCase())
  );

  const inputStyle = {
    width: "100%", background: colors.input, border: `1px solid ${colors.border}`,
    borderRadius: 6, padding: "10px 14px", color: colors.text,
    fontSize: 14, fontFamily: mono, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ maxWidth: 580, margin: "0 auto", paddingTop: 32 }}>
      <Card>
        <CardTitle icon="⬛">Open Terminal</CardTitle>

        {/* Repo list */}
        <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Your repositories
        </p>

        {error && (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.red, fontFamily: mono }}>{error}</p>
        )}

        {repos === null && !error && (
          <p style={{ color: colors.dim, fontFamily: mono, fontSize: 13, marginBottom: 12 }}>Loading…</p>
        )}

        {repos !== null && (
          <>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter repos…"
              style={{ ...inputStyle, marginBottom: 8 }}
              autoFocus
            />
            <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${colors.border}`, borderRadius: 6, marginBottom: 16 }}>
              {filtered.length === 0 ? (
                <p style={{ margin: 0, padding: "12px 14px", color: colors.dim, fontFamily: mono, fontSize: 13 }}>
                  {repos.length === 0 ? "No repos found — check your GitHub token scope." : "No match."}
                </p>
              ) : (
                filtered.map(r => (
                  <button key={r} onClick={() => onSelect(r)} style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: "none", border: "none", borderBottom: `1px solid ${colors.border}`,
                    padding: "10px 14px", color: colors.text, cursor: "pointer",
                    fontFamily: mono, fontSize: 13,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => e.target.style.background = colors.surface}
                  onMouseLeave={e => e.target.style.background = "none"}
                  >
                    {r}
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {/* Custom repo */}
        <p style={{ margin: "0 0 8px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Or enter manually
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => e.key === "Enter" && custom && onSelect(custom)}
            placeholder="owner/repo"
            style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
          />
          <Btn variant="primary" onClick={() => onSelect(custom)} disabled={!custom}>
            Clone
          </Btn>
        </div>

        <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => onSelect("")} style={{
            background: "none", border: "none", color: colors.muted, cursor: "pointer",
            fontFamily: mono, fontSize: 12, textDecoration: "underline",
          }}>
            Open plain shell (no clone)
          </button>
          <div style={{ fontSize: 12, color: colors.dim, fontFamily: mono, textAlign: "right" }}>
            workflow: run <span style={{ color: colors.cyan }}>claude</span> → write <span style={{ color: colors.green }}>issue.json</span> → run <span style={{ color: colors.green }}>create_issue</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Admin panel ─────────────────────────────────────────────────────────────

function AdminPanel() {
  const [stats, setStats]   = useState(null);
  const [users, setUsers]   = useState(null);
  const [runs,  setRuns]    = useState(null);
  const [filter, setFilter] = useState("");
  const [err,   setErr]     = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, u, r] = await Promise.all([api.adminStats(), api.adminUsers(), api.adminRuns()]);
      setStats(s);
      setUsers(u ?? []);
      setRuns(r ?? []);
    } catch (e) {
      const msg = e?.message ?? "Failed to load admin data";
      setErr(msg);
      toast(msg);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmtDuration = (secs) => {
    if (secs == null) return "—";
    if (secs < 60)  return `${secs}s`;
    return `${Math.floor(secs / 60)}m${secs % 60}s`;
  };

  const fmtTime = (ts) => ts ? new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const shortID = (id) => id ? id.slice(0, 8) + "…" : "—";

  const filteredRuns = filter
    ? (runs ?? []).filter(r => r.account_id.startsWith(filter))
    : (runs ?? []);

  const statusColor = { completed: colors.green, failed: colors.red, running: colors.orange };

  return (
    <div>
      {err && (
        <div style={{ padding: "12px 16px", background: `${colors.red}11`, border: `1px solid ${colors.red}44`, borderRadius: 8, marginBottom: 20, fontFamily: mono, fontSize: 13, color: colors.red }}>
          ✗ {err}
        </div>
      )}

      {/* Stats bar */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            ["Users",     stats.total_users, colors.cyan],
            ["Total Runs",stats.total_runs,  colors.text],
            ["Today",     stats.runs_today,  colors.cyan],
            ["Completed", stats.completed,   colors.green],
            ["Failed",    stats.failed,      colors.red],
            ["Running",   stats.running,     colors.orange],
          ].map(([label, val, color]) => (
            <StatCard key={label} label={label} value={val ?? 0} color={color} />
          ))}
        </div>
      )}

      {/* Users table */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>Users</p>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {["Email", "Total", "Completed", "Failed", "Last Run"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, color: colors.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(users ?? []).length === 0 && (
                <tr><td colSpan={5} style={{ padding: "20px 16px", color: colors.dim, textAlign: "center" }}>No users yet</td></tr>
              )}
              {(users ?? []).map(u => (
                <tr key={u.account_id} style={{ borderBottom: `1px solid ${colors.border}22`, cursor: "pointer" }}
                  onClick={() => setFilter(f => f === u.account_id ? "" : u.account_id)}>
                  <td style={{ padding: "10px 16px", color: filter === u.account_id ? colors.cyan : colors.text }}>{u.email || shortID(u.account_id)}</td>
                  <td style={{ padding: "10px 16px", color: colors.text }}>{u.total}</td>
                  <td style={{ padding: "10px 16px", color: colors.green }}>{u.completed}</td>
                  <td style={{ padding: "10px 16px", color: u.failed > 0 ? colors.red : colors.muted }}>{u.failed}</td>
                  <td style={{ padding: "10px 16px", color: colors.muted }}>{fmtTime(u.last_run_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filter && (
          <p style={{ margin: "6px 0 0", fontSize: 12, color: colors.cyan, fontFamily: mono }}>
            Filtering by {shortID(filter)} — <button onClick={() => setFilter("")} style={{ background: "none", border: "none", color: colors.cyan, cursor: "pointer", fontFamily: mono, fontSize: 12, textDecoration: "underline", padding: 0 }}>clear</button>
          </p>
        )}
      </div>

      {/* Runs table */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Run History {filter ? `· ${shortID(filter)}` : "(all users)"}
          </p>
          <button onClick={load} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 12, fontFamily: mono }}>
            refresh
          </button>
        </div>
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {["User", "Repo", "Issue", "Status", "Duration", "When", "PR / Error"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, color: colors.muted, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRuns.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "20px 14px", color: colors.dim, textAlign: "center" }}>No runs</td></tr>
              )}
              {filteredRuns.map(run => {
                const col = statusColor[run.status] ?? colors.muted;
                return (
                  <tr key={run.id} style={{ borderBottom: `1px solid ${colors.border}11` }}>
                    <td style={{ padding: "9px 14px", color: colors.muted }}>{shortID(run.account_id)}</td>
                    <td style={{ padding: "9px 14px", color: colors.text, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.repo}</td>
                    <td style={{ padding: "9px 14px", color: colors.muted }}>#{run.issue_number}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span style={{ color: col, fontSize: 11, padding: "2px 8px", borderRadius: 4, background: `${col}18`, border: `1px solid ${col}44` }}>{run.status}</span>
                    </td>
                    <td style={{ padding: "9px 14px", color: colors.muted }}>{fmtDuration(run.duration_sec)}</td>
                    <td style={{ padding: "9px 14px", color: colors.dim, whiteSpace: "nowrap" }}>{fmtTime(run.started_at)}</td>
                    <td style={{ padding: "9px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {run.pr_url
                        ? <a href={run.pr_url} target="_blank" rel="noreferrer" style={{ color: colors.green, textDecoration: "none" }}>view PR</a>
                        : run.error
                          ? <span style={{ color: colors.red }} title={run.error}>{run.error.slice(0, 60)}</span>
                          : <span style={{ color: colors.dim }}>—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ config, setConfig, onStop, onLaunch, launching, status, onLogout, auth, onReset }) {
  const [dashTab, setDashTab] = useState("monitor");
  const isAdmin = !!auth?.is_admin;
  const setAgent    = (role) => (val) => setConfig(c => ({ ...c, agents: { ...c.agents, [role]: val } }));
  const setGithub   = (key)  => (val) => setConfig(c => ({ ...c, github:   { ...c.github,   [key]: val } }));
  const setPipeline = (key)  => (val) => setConfig(c => ({ ...c, pipeline: { ...c.pipeline, [key]: val } }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api.saveConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      toast(e?.message ?? "Save failed");
    }
    setSaving(false);
  };

  const q = status?.queue ?? {};

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: sans, padding: "40px 28px" }}>
      <div style={{ maxWidth: 1020, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src="/logo-48.png" alt="Torch" style={{ width: 48, height: 48, borderRadius: 12 }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors.green, boxShadow: `0 0 10px ${colors.green}`, animation: "pulse 2s infinite" }} />
                <span style={{ fontSize: 12, letterSpacing: "0.2em", color: colors.green, textTransform: "uppercase", fontFamily: mono }}>live</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: colors.white, letterSpacing: "-0.02em" }}>Torch</h1>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {status?.active
              ? <Btn variant="danger" onClick={onStop}>■ Stop</Btn>
              : <Btn variant="primary" onClick={onLaunch} disabled={launching}>{launching ? "Starting…" : "▶ Start Pipeline"}</Btn>
            }
            <Btn variant="ghost" onClick={onLogout}>Logout</Btn>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 28 }}>
          <StatCard label="Pending"   value={q.pending   ?? 0} color={colors.cyan}   sub="in queue" />
          <StatCard label="Active"    value={q.active    ?? 0} color={colors.orange} sub="processing" />
          <StatCard label="Completed" value={q.completed ?? 0} color={colors.green}  sub="total done" />
          <StatCard label="Failed"    value={q.failed    ?? 0} color={colors.red}    sub="needs attention" />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${colors.border}`, marginBottom: 24, overflowX: "auto" }}>
          {[["monitor", "Monitor"], ["terminal", "Terminal"], ["issues", "Issues"], ["settings", "Settings"], ...(isAdmin ? [["admin", "Admin"]] : [])].map(([id, label]) => (
            <button key={id} onClick={() => setDashTab(id)} style={{
              padding: "10px 22px", background: "none", border: "none",
              borderBottom: `2px solid ${dashTab === id ? colors.cyan : "transparent"}`,
              color: dashTab === id ? colors.cyan : colors.muted,
              cursor: "pointer", fontFamily: mono, fontSize: 13, fontWeight: 600,
              letterSpacing: "0.08em", textTransform: "uppercase",
              transition: "all 0.15s", marginBottom: -1, whiteSpace: "nowrap",
            }}>{label}</button>
          ))}
        </div>

        {/* Monitor tab */}
        {dashTab === "monitor" && (
          <div>
            {/* Pipeline flow */}
            <div style={{ padding: "18px 24px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
              {["developer", "tester", "reviewer"].map((role, i) => {
                const meta = AGENT_META[role];
                return (
                  <div key={role} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6, background: `${meta.color}11`, border: `1px solid ${meta.color}33` }}>
                      <span style={{ fontSize: 15 }}>{meta.icon}</span>
                      <span style={{ fontSize: 13, color: meta.color, fontFamily: mono, fontWeight: 600 }}>{meta.label.toLowerCase()}</span>
                      <span style={{ fontSize: 12, color: colors.muted, fontFamily: mono }}>({config.agents[role].cli})</span>
                    </div>
                    {i < 2 && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        <span style={{ color: colors.dim, fontSize: 15 }}>→</span>
                        <span style={{ fontSize: 11, color: colors.dim, fontFamily: mono }}>fix loop ↩</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live log */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Live Agent Output
              </p>
              <LiveLogPanel runs={status?.runs} />
            </div>

            {/* Run history */}
            <div style={{ marginBottom: 28 }}>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Run History
              </p>
              <RunsList runs={status?.runs} />
            </div>
          </div>
        )}

        {/* Terminal tab */}
        {dashTab === "terminal" && (
          <TerminalPanel auth={auth} />
        )}

        {/* Issues tab */}
        {dashTab === "issues" && (
          <IssuesPanel triggerLabel={config.github.trigger_label} pipelineActive={status?.active} config={config} setConfig={setConfig} />
        )}

        {/* Settings tab */}
        {dashTab === "settings" && (
          <div>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: colors.muted, fontFamily: mono }}>
              Changes take effect on the next pipeline run. The webhook listener stays active.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
              {["developer", "tester", "reviewer"].map(role => (
                <AgentCard key={role} role={role} config={config.agents[role] ?? defaultAgent(role)} onChange={setAgent(role)} />
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <Card>
                <CardTitle icon="🔑">GitHub</CardTitle>
                <Field label="Token"          value={config.github.token}          onChange={setGithub("token")}          type="password" placeholder="ghp_..." isCode />
                <Field label="Webhook Secret" value={config.github.webhook_secret} onChange={setGithub("webhook_secret")} type="password" placeholder="your-secret" isCode />
                <Field label="Trigger Label"  value={config.github.trigger_label}  onChange={setGithub("trigger_label")}  placeholder="ai-implement" isCode />
                <Field label="Base Branch"    value={config.github.base_branch}    onChange={setGithub("base_branch")}    placeholder="main" isCode />
              </Card>
              <Card>
                <CardTitle icon="⚙">Pipeline</CardTitle>
                <Field label="Workspaces Dir" value={config.pipeline.workspaces_dir} onChange={setPipeline("workspaces_dir")} placeholder="/workspaces" isCode />
                <Field label="Test Command"   value={config.pipeline.test_command || ""} onChange={setPipeline("test_command")} placeholder="flutter test"    isCode hint="{test_command} in prompts" />
                <Field label="Lint Command"   value={config.pipeline.lint_command || ""} onChange={setPipeline("lint_command")} placeholder="flutter analyze" isCode hint="{lint_command} in prompts" />
                <ExtraEnvEditor value={config.pipeline.extra_env || {}} onChange={setPipeline("extra_env")} />
                {Object.values(config.agents).some(a => a.cli === "opencode") && (
                  <Field label="Opencode Config (opencode.json)" value={config.pipeline.opencode_config || ""} onChange={setPipeline("opencode_config")} rows={10} isCode placeholder={'{\n  "provider": { ... },\n  "model": "vllm/vllm/mimir"\n}'} hint="Injected into each workspace. All 3 agents share the same file." />
                )}
                <div>
                  <label style={{ fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", fontFamily: mono, display: "block", marginBottom: 8 }}>Max Fix Rounds</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4, 5].map(n => <Pill key={n} n={n} active={config.pipeline.max_fix_rounds === n} color={colors.white} onClick={n => setPipeline("max_fix_rounds")(n)} />)}
                  </div>
                </div>
              </Card>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Btn variant="danger" onClick={async () => {
                if (!confirm("Reset all configuration? This will clear agents, GitHub token, and pipeline settings.")) return;
                const blank = emptyConfig();
                await api.saveConfig(blank);
                setConfig(blank);
                onReset();
              }}>
                Reset to defaults
              </Btn>
              <Btn variant={saved ? "primary" : "default"} onClick={saveSettings} disabled={saving}>
                {saving ? "Saving..." : saved ? "✓ Saved" : "Save Changes"}
              </Btn>
            </div>
          </div>
        )}

        {/* Admin tab */}
        {dashTab === "admin" && isAdmin && <AdminPanel />}

        <p style={{ margin: 0, fontSize: 12, color: colors.dim, fontFamily: mono, textAlign: "center" }}>
          refreshing every 5s · webhook: <span style={{ color: colors.dim }}>{window.location.origin}/webhook/github/{auth?.sub ?? "…"}</span>
        </p>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

// ─── Login page ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }) {
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [tfaCode,      setTfaCode]      = useState("");
  const [totpSession,  setTotpSession]  = useState(null);
  const [isLoading,    setIsLoading]    = useState(false);
  const [error,        setError]        = useState(null);

  const inputStyle = {
    width: "100%", background: colors.input, border: `1px solid ${colors.border}`,
    borderRadius: 6, padding: "10px 14px", color: colors.text,
    fontSize: 15, fontFamily: sans, outline: "none", boxSizing: "border-box",
    transition: "border-color 0.15s",
  };
  const onFocus = (e) => (e.target.style.borderColor = colors.borderHover);
  const onBlur  = (e) => (e.target.style.borderColor = colors.border);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.endsWith("@cubbit.io")) {
      setError("Only Cubbiters can access");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const { login } = await import("./cubbitAuth.js");
      const result = await login(email, password);
      if (result.totpSessionId) {
        setTotpSession(result.totpSessionId);
      } else {
        onLogin(result.token);
      }
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTFA = async (e) => {
    e.preventDefault();
    if (!totpSession) return;
    setError(null);
    setIsLoading(true);
    try {
      const { verifyTFAAndLogin } = await import("./cubbitAuth.js");
      const token = await verifyTFAAndLogin(totpSession, tfaCode);
      onLogin(token);
    } catch (err) {
      setError(err.message || "TFA verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="/logo.png" alt="Torch" style={{ width: 120, height: 120, margin: "0 auto 8px", display: "block", borderRadius: 28 }} />
          <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: mono }}>sign in with your Cubbit account</p>
        </div>

        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 28 }}>
          {error && (
            <div style={{ background: `${colors.red}15`, border: `1px solid ${colors.red}40`, borderRadius: 6, padding: "10px 14px", marginBottom: 20 }}>
              <p style={{ margin: 0, fontSize: 13, color: colors.red, fontFamily: mono }}>{error}</p>
            </div>
          )}

          {!totpSession ? (
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", marginBottom: 6, fontFamily: mono }}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} placeholder="you@cubbit.io" required disabled={isLoading} onFocus={onFocus} onBlur={onBlur} />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", marginBottom: 6, fontFamily: mono }}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} placeholder="••••••••" required disabled={isLoading} onFocus={onFocus} onBlur={onBlur} />
              </div>
              <button type="submit" disabled={isLoading} style={{
                width: "100%", padding: "11px 24px", borderRadius: 8,
                border: `1px solid ${colors.green}`, cursor: isLoading ? "not-allowed" : "pointer",
                fontFamily: mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.05em",
                background: `${colors.green}22`, color: colors.green, opacity: isLoading ? 0.5 : 1,
                transition: "all 0.2s",
              }}>
                {isLoading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleTFA}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: mono }}>Enter your 2FA code</p>
              </div>
              <div style={{ marginBottom: 24 }}>
                <input type="text" value={tfaCode} onChange={e => setTfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  style={{ ...inputStyle, textAlign: "center", fontSize: 28, letterSpacing: "0.4em", fontFamily: mono }}
                  placeholder="000000" maxLength={6} required disabled={isLoading} autoFocus
                  onFocus={onFocus} onBlur={onBlur} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => { setTotpSession(null); setTfaCode(""); }} disabled={isLoading}
                  style={{ flex: 1, padding: "11px 0", borderRadius: 8, border: `1px solid ${colors.border}`, cursor: "pointer", fontFamily: mono, fontSize: 13, fontWeight: 600, background: "transparent", color: colors.muted }}>
                  Back
                </button>
                <button type="submit" disabled={isLoading || tfaCode.length < 6}
                  style={{ flex: 1, padding: "11px 0", borderRadius: 8, border: `1px solid ${colors.green}`, cursor: isLoading || tfaCode.length < 6 ? "not-allowed" : "pointer", fontFamily: mono, fontSize: 13, fontWeight: 600, background: `${colors.green}22`, color: colors.green, opacity: isLoading || tfaCode.length < 6 ? 0.5 : 1 }}>
                  {isLoading ? "Verifying…" : "Verify"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function Card({ children, accent, style: s }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderTop: accent ? `2px solid ${accent}` : undefined, borderRadius: 10, padding: 22, position: "relative", overflow: "hidden", ...s }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 50, background: `radial-gradient(ellipse at 50% -20%, ${accent}18 0%, transparent 70%)`, pointerEvents: "none" }} />}
      {children}
    </div>
  );
}

function CardTitle({ children, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      <span style={{ fontSize: 15, fontWeight: 700, color: colors.white, fontFamily: sans }}>{children}</span>
    </div>
  );
}

function SectionTitle({ children, style: s }) {
  return <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: colors.white, letterSpacing: "-0.01em", ...s }}>{children}</h2>;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [config,       setConfig]      = useState(emptyConfig());
  const [status,       setStatus]      = useState(null);
  const [loading,      setLoading]     = useState(true);
  const [loadError,    setLoadError]   = useState(null);
  const [launching,    setLaunching]   = useState(false);
  const [auth,         setAuth]        = useState(() => loadAuthWithoutExpiry());
  // true only when the backend already has a saved GitHub token
  const [isConfigured, setIsConfigured] = useState(false);
  const pollRef = useRef(null);

  const loadAll = useCallback(async () => {
    const [cfg, st] = await Promise.all([api.getConfig(), api.getStatus()]);
    setConfig(cfg);
    setStatus(st);
    setIsConfigured(!!cfg.github?.token);
  }, []);

  const handleLogout = useCallback(() => {
    // Fire-and-forget: try to invalidate server-side session
    const stored = localStorage.getItem("torch_auth");
    if (stored) {
      try {
        const { token } = JSON.parse(stored);
        if (token) fetch("/api/session", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      } catch {}
    }
    clearAuth();
    setAuth(null);
    setStatus(null);
    setIsConfigured(false);
    setLoadError(null);
    setLoading(false);
  }, []);

  const handleLogin = useCallback(async (tokenResponse) => {
    // Exchange the Cubbit JWT for a local session token issued by our backend.
    const cubbitJWT = tokenResponse?.token;
    if (!cubbitJWT || typeof cubbitJWT !== "string") {
      setLoadError("Invalid Cubbit token received");
      return;
    }
    let sessionToken, accountId, isAdmin = false;
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cubbit_token: cubbitJWT }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Session creation failed");
      }
      ({ session_token: sessionToken, account_id: accountId, is_admin: isAdmin } = await res.json());
    } catch (err) {
      setLoadError(err.message);
      return;
    }
    const newAuth = saveAuth(sessionToken, accountId, isAdmin);
    setAuth(newAuth);
    setLoadError(null);
    setLoading(true);
    try {
      await loadAll();
    } catch (err) {
      if (err?.status === 401) handleLogout();
      else setLoadError(err?.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  }, [loadAll, handleLogout]);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    loadAll()
      .catch(err => {
        if (err?.status === 401) handleLogout();
        else setLoadError(err?.message || "Failed to connect");
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll status every 5s when active
  useEffect(() => {
    if (status?.active) {
      pollRef.current = setInterval(() => {
        api.getStatus().then(setStatus).catch(e => toast(e?.message ?? "Status poll failed"));
      }, 5000);
    }
    return () => clearInterval(pollRef.current);
  }, [status?.active]);

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await api.saveConfig(config);
      await api.start();
      const st = await api.getStatus();
      setStatus(st);
      setIsConfigured(true); // wizard complete — move to Dashboard
    } catch (e) {
      toast(e?.message ?? "Launch failed");
    }
    setLaunching(false);
  };

  const handleStop = async () => {
    try {
      await api.stop();
      const st = await api.getStatus();
      setStatus(st);
    } catch (e) {
      toast(e?.message ?? "Stop failed");
    }
  };

  if (loading) return (
    <ToastProvider>
      <div style={{ minHeight: "100vh", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: colors.muted, fontFamily: mono, fontSize: 15 }}>loading...</p>
      </div>
    </ToastProvider>
  );

  if (!auth) return <ToastProvider><LoginPage onLogin={handleLogin} /></ToastProvider>;

  if (loadError) return (
    <ToastProvider>
      <div style={{ minHeight: "100vh", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: colors.red,  fontFamily: mono, fontSize: 15 }}>Cannot reach backend</p>
          <p style={{ color: colors.muted, fontFamily: mono, fontSize: 13 }}>{loadError}</p>
          <Btn style={{ marginTop: 12 }} onClick={() => window.location.reload()}>retry</Btn>
        </div>
      </div>
    </ToastProvider>
  );

  const inner = (() => {
    if (status && isConfigured) {
      return <Dashboard config={config} setConfig={setConfig} onStop={handleStop} onLaunch={handleLaunch} launching={launching} status={status} onLogout={handleLogout} auth={auth} onReset={() => setIsConfigured(false)} />;
    }
    return <SetupWizard config={config} setConfig={setConfig} onLaunch={handleLaunch} launching={launching} onLogout={handleLogout} auth={auth} />;
  })();

  return <ToastProvider>{inner}</ToastProvider>;
}
