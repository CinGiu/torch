import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROMPTS = {
  developer: `You are an expert developer working on a production codebase.

Your task:
1. Explore the codebase — understand existing patterns, architecture, naming conventions
2. Implement the feature described in the issue
3. Write appropriate unit tests
4. Run '{lint_command}' — fix ALL warnings and errors
5. Run '{test_command}' — all tests must pass
6. Stage all changes with 'git add .'

Rules:
- Match existing code style exactly
- Minimal, focused changes — do not over-engineer
- Do not modify dependency files unless strictly necessary
- Never break existing tests
- Do NOT commit — only stage changes`,

  tester: `You are a senior QA engineer. Your job is to WRITE tests, not just run them.

Steps:
1. Read the issue description and understand expected behavior
2. Run 'git diff --staged' to see exactly what the developer implemented
3. Identify all new functions, classes, and logic paths that lack test coverage
4. Write unit tests (and integration tests where appropriate) that cover:
   - The happy path for every new feature
   - Edge cases and boundary conditions
   - Error/failure scenarios
5. Follow existing test conventions and file structure in the project
6. Stage all new/modified test files with 'git add .'
7. Run '{lint_command}' — fix any issues in the test files you wrote
8. Run '{test_command}' — all tests must pass before you finish

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "if failed: what tests are still missing or failing, and why",
  "issues": ["specific issue 1", "specific issue 2"]
}

Return failed if: any test fails, you could not write meaningful tests, or critical paths are still untested.`,

  reviewer: `You are a senior software architect doing a code review.

Steps:
1. Run 'git diff --staged' to see all changes
2. Review for: correctness, code quality, architecture, security, performance
3. Check that implementation matches the issue requirements exactly
4. Verify naming conventions and code style match the existing codebase

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "detailed list of required changes (empty if success)",
  "comments": ["comment 1", "comment 2"]
}

Be constructive but strict. Reject if there are architectural issues or missing requirements.`,
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
  args: DEFAULT_ARGS.claude[role],
  system_prompt: DEFAULT_PROMPTS[role],
  max_fix_rounds: 3,
});

const emptyConfig = () => ({
  pipeline: { workspaces_dir: "/workspaces", max_fix_rounds: 3, test_command: "flutter test", lint_command: "flutter analyze", active: false },
  github:   { token: "", webhook_secret: "", trigger_label: "ai-implement", base_branch: "main" },
  agents:   { developer: defaultAgent("developer"), tester: defaultAgent("tester"), reviewer: defaultAgent("reviewer") },
});

// ─── API ──────────────────────────────────────────────────────────────────────

const api = {
  getConfig:    () => fetch("/api/config").then(r => r.json()),
  saveConfig:   (cfg) => fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) }).then(r => r.json()),
  getStatus:    () => fetch("/api/status").then(r => r.json()),
  start:        () => fetch("/api/pipeline/start",  { method: "POST" }).then(r => r.json()),
  stop:         () => fetch("/api/pipeline/stop",   { method: "POST" }).then(r => r.json()),
  listIssues:   (repo) => fetch(`/api/issues?repo=${encodeURIComponent(repo)}`).then(r => { if (!r.ok) return r.json().then(e => Promise.reject(e.error)); return r.json(); }),
  triggerIssue: (body) => fetch("/api/pipeline/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  getLiveLog:   (issue) => fetch(`/api/live-log?issue=${issue}`).then(r => r.json()),
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
        <Field label="Anthropic API Key" value={config.api_key || ""} onChange={v => set("api_key", v)} type="password" placeholder="sk-ant-..." isCode />
      )}
      {config.cli === "opencode" && (
        <div style={{ padding: "10px 14px", background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 12, color: colors.muted, fontFamily: mono }}>
            Provider, model and API key are configured via <span style={{ color: colors.cyan }}>Pipeline → Opencode Config</span> (opencode.json injected into each workspace).
          </p>
        </div>
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

function SetupWizard({ config, setConfig, onLaunch, launching }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const setAgent    = (role) => (val) => setConfig(c => ({ ...c, agents: { ...c.agents, [role]: val } }));
  const setGithub   = (key)  => (val) => setConfig(c => ({ ...c, github:   { ...c.github,   [key]: val } }));
  const setPipeline = (key)  => (val) => setConfig(c => ({ ...c, pipeline: { ...c.pipeline, [key]: val } }));

  const saveAndNext = async () => {
    setSaving(true);
    try { await api.saveConfig(config); } catch {}
    setSaving(false);
    setStep(s => s + 1);
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: sans, padding: "40px 28px" }}>
      <div style={{ maxWidth: 1020, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: colors.orange, boxShadow: `0 0 8px ${colors.orange}` }} />
            <span style={{ fontSize: 13, letterSpacing: "0.2em", color: colors.orange, textTransform: "uppercase", fontFamily: mono }}>setup</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: colors.white, letterSpacing: "-0.02em" }}>Torch</h1>
          <p style={{ margin: "8px 0 0", fontSize: 15, color: colors.muted, fontFamily: mono }}>Configure your agents and connect GitHub to get started.</p>
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
                  {[["Contents", "Read & write", "clone + push"], ["Pull requests", "Read & write", "opens the PR"], ["Issues", "Read & write", "labels + comments"], ["Metadata", "Read", "required"]].map(([scope, level, note]) => (
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
              </div>
            </Card>

            <Card style={{ marginTop: 16 }}>
              <CardTitle icon="⚡">Webhook</CardTitle>
              <Field label="Webhook Secret" value={config.github.webhook_secret} onChange={setGithub("webhook_secret")} type="password" placeholder="a long random string" isCode />
              <div style={{ padding: "14px 18px", background: colors.input, borderRadius: 8, border: `1px solid ${colors.border}` }}>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: colors.muted, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>Configure on GitHub</p>
                <p style={{ margin: 0, fontSize: 13, color: colors.muted, fontFamily: mono, lineHeight: 1.9 }}>
                  repo → Settings → Webhooks → Add webhook<br />
                  Payload URL: <span style={{ color: colors.cyan }}>https://your-server:8080/webhook/github</span><br />
                  Content type: <span style={{ color: colors.text }}>application/json</span> · Events: <span style={{ color: colors.text }}>Issues</span>
                </p>
              </div>
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
    await api.saveConfig(updated).catch(() => {});
  };

  const removeRepo = async (r) => {
    const updated = { ...config, github: { ...config.github, repos: savedRepos.filter(x => x !== r) } };
    setConfig(updated);
    await api.saveConfig(updated).catch(() => {});
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
          <p style={{ margin: "3px 0 0", fontSize: 11, color: colors.dim, fontFamily: mono }}>Injected into every agent process. For PATH, the value is prepended to the existing PATH.</p>
        </div>
        <button onClick={add} style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.muted, cursor: "pointer", padding: "3px 10px", fontSize: 12, fontFamily: mono, flexShrink: 0 }}>+ add</button>
      </div>
      {entries.length === 0 && (
        <p style={{ fontSize: 12, color: colors.dim, fontFamily: mono, margin: 0 }}>e.g. <span style={{ color: colors.cyan }}>PATH</span> → <span style={{ color: colors.text }}>/opt/flutter/bin:/opt/android-sdk/cmdline-tools/latest/bin</span></p>
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
    const fetch_ = () => api.getLiveLog(issue).then(setLines).catch(() => {});
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ config, setConfig, onStop, status }) {
  const [dashTab, setDashTab] = useState("monitor");
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
    } catch {}
    setSaving(false);
  };

  const q = status?.queue ?? {};

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: sans, padding: "40px 28px" }}>
      <div style={{ maxWidth: 1020, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 36 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: colors.green, boxShadow: `0 0 10px ${colors.green}`, animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 13, letterSpacing: "0.2em", color: colors.green, textTransform: "uppercase", fontFamily: mono }}>live</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: colors.white, letterSpacing: "-0.02em" }}>Torch</h1>
          </div>
          <Btn variant="danger" onClick={onStop}>■ Stop Pipeline</Btn>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 28 }}>
          <StatCard label="Pending"   value={q.pending   ?? 0} color={colors.cyan}   sub="in queue" />
          <StatCard label="Active"    value={q.active    ?? 0} color={colors.orange} sub="processing" />
          <StatCard label="Completed" value={q.completed ?? 0} color={colors.green}  sub="total done" />
          <StatCard label="Failed"    value={q.failed    ?? 0} color={colors.red}    sub="needs attention" />
        </div>

        {/* Tabs: Monitor | Issues | Settings */}
        <div style={{ display: "flex", borderBottom: `1px solid ${colors.border}`, marginBottom: 24 }}>
          {[["monitor", "Monitor"], ["issues", "Issues"], ["settings", "Settings"]].map(([id, label]) => (
            <button key={id} onClick={() => setDashTab(id)} style={{
              padding: "10px 22px", background: "none", border: "none",
              borderBottom: `2px solid ${dashTab === id ? colors.cyan : "transparent"}`,
              color: dashTab === id ? colors.cyan : colors.muted,
              cursor: "pointer", fontFamily: mono, fontSize: 13, fontWeight: 600,
              letterSpacing: "0.08em", textTransform: "uppercase",
              transition: "all 0.15s", marginBottom: -1,
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
                <AgentCard key={role} role={role} config={config.agents[role]} onChange={setAgent(role)} />
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
                <Field label="Opencode Config (opencode.json)" value={config.pipeline.opencode_config || ""} onChange={setPipeline("opencode_config")} rows={10} isCode placeholder={'{\n  "provider": { ... },\n  "model": "vllm/vllm/mimir"\n}'} hint="Injected into each workspace. All 3 agents share the same file." />
                <div>
                  <label style={{ fontSize: 12, letterSpacing: "0.1em", color: colors.muted, textTransform: "uppercase", fontFamily: mono, display: "block", marginBottom: 8 }}>Max Fix Rounds</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4, 5].map(n => <Pill key={n} n={n} active={config.pipeline.max_fix_rounds === n} color={colors.white} onClick={n => setPipeline("max_fix_rounds")(n)} />)}
                  </div>
                </div>
              </Card>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Btn variant={saved ? "primary" : "default"} onClick={saveSettings} disabled={saving}>
                {saving ? "Saving..." : saved ? "✓ Saved" : "Save Changes"}
              </Btn>
            </div>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 12, color: colors.dim, fontFamily: mono, textAlign: "center" }}>
          refreshing every 5s · webhook active on <span style={{ color: colors.dim }}>/webhook/github</span>
        </p>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
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
  const [config,       setConfig]       = useState(emptyConfig());
  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState(null);
  const [launching, setLaunching] = useState(false);
  const pollRef = useRef(null);

  const loadAll = useCallback(async () => {
    const [cfg, st] = await Promise.all([api.getConfig(), api.getStatus()]);
    setConfig(cfg);
    setStatus(st);
  }, []);

  useEffect(() => {
    loadAll()
      .catch(err => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [loadAll]);

  // Poll status every 5s when active
  useEffect(() => {
    if (status?.active) {
      pollRef.current = setInterval(() => {
        api.getStatus().then(setStatus).catch(() => {});
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
    } catch {}
    setLaunching(false);
  };

  const handleStop = async () => {
    await api.stop();
    const st = await api.getStatus();
    setStatus(st);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: colors.muted, fontFamily: mono, fontSize: 15 }}>loading...</p>
    </div>
  );

  if (loadError) return (
    <div style={{ minHeight: "100vh", background: colors.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: colors.red,  fontFamily: mono, fontSize: 15 }}>Cannot reach backend</p>
        <p style={{ color: colors.muted, fontFamily: mono, fontSize: 13 }}>{loadError}</p>
        <Btn style={{ marginTop: 12 }} onClick={() => window.location.reload()}>retry</Btn>
      </div>
    </div>
  );

  if (status?.active) {
    return <Dashboard config={config} setConfig={setConfig} onStop={handleStop} status={status} />;
  }

  return <SetupWizard config={config} setConfig={setConfig} onLaunch={handleLaunch} launching={launching} />;
}
