import { useState, useEffect, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROMPTS = {
  developer: `You are an expert Flutter developer working on a production app.

Your task:
1. Explore the codebase — understand existing patterns, architecture, naming conventions
2. Implement the feature described in the issue
3. Write appropriate tests (unit or widget)
4. Run 'flutter analyze' — fix ALL warnings and errors
5. Run 'flutter test' — all tests must pass
6. Stage all changes with 'git add .'

Rules:
- Match existing code style exactly
- Minimal, focused changes — do not over-engineer
- Do not modify pubspec.yaml unless strictly necessary
- Never break existing tests
- Do NOT commit — only stage changes`,

  tester: `You are a senior Flutter QA engineer.

Steps:
1. Read the issue description and understand expected behavior
2. Review all staged/modified files (use 'git diff --staged')
3. Run 'flutter analyze' and report any issues
4. Run 'flutter test' and report any failures
5. Check test coverage — are new features adequately tested?
6. Check edge cases — are they handled?

Output format (respond with this exact JSON structure):
{
  "status": "success" | "failed",
  "feedback": "detailed description of what must be fixed (empty if success)",
  "issues": ["issue 1", "issue 2"]
}

Be strict. If tests are missing or coverage is inadequate, return failed.`,

  reviewer: `You are a senior Flutter architect doing a code review.

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
    developer: ["--print", "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep", "--max-turns", "40"],
    tester: ["--print", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"],
    reviewer: ["--print", "--allowedTools", "Bash,Read,Glob,Grep", "--max-turns", "20"],
  },
  opencode: {
    developer: ["run", "--no-interactive"],
    tester: ["run", "--no-interactive"],
    reviewer: ["run", "--no-interactive"],
  },
};

const AGENT_META = {
  developer: { icon: "⌨", label: "Developer", color: "#00d4ff", desc: "Implements the feature from the issue" },
  tester:    { icon: "⬡", label: "Tester",    color: "#00ff9d", desc: "Runs tests and checks coverage" },
  reviewer:  { icon: "◈", label: "Reviewer",  color: "#ff6b35", desc: "Reviews code quality and architecture" },
};

const defaultAgent = (role) => ({
  cli: "claude",
  api_key: "",
  base_url: "",
  model: "",
  args: DEFAULT_ARGS.claude[role],
  system_prompt: DEFAULT_PROMPTS[role],
  max_fix_rounds: 3,
});

const emptyConfig = () => ({
  pipeline: { workspaces_dir: "/workspaces", max_fix_rounds: 3 },
  github:   { token: "", webhook_secret: "", trigger_label: "ai-implement", base_branch: "main" },
  agents: {
    developer: defaultAgent("developer"),
    tester:    defaultAgent("tester"),
    reviewer:  defaultAgent("reviewer"),
  },
});

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postConfig(cfg) {
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

const mono = "'JetBrains Mono', monospace";
const sans = "'Syne', sans-serif";

function Field({ label, value, onChange, type = "text", placeholder, isCode = false, rows, hint }) {
  const base = {
    width: "100%", background: "#0a0a0f", border: "1px solid #1a1a2e",
    borderRadius: 6, padding: "8px 12px", color: "#c9d1d9",
    fontSize: type === "password" ? 13 : isCode ? 12 : 13,
    fontFamily: isCode ? mono : sans,
    outline: "none", boxSizing: "border-box",
    transition: "border-color 0.15s",
    resize: rows ? "vertical" : undefined,
  };

  const handleFocus = (e) => (e.target.style.borderColor = "#ffffff33");
  const handleBlur  = (e) => (e.target.style.borderColor = "#1a1a2e");

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, letterSpacing: "0.1em", color: "#555", textTransform: "uppercase", marginBottom: 5, fontFamily: mono }}>
        {label}
      </label>
      {rows ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
          placeholder={placeholder} style={base} onFocus={handleFocus} onBlur={handleBlur} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} style={base} onFocus={handleFocus} onBlur={handleBlur} />
      )}
      {hint && <p style={{ margin: "4px 0 0", fontSize: 10, color: "#444", fontFamily: mono }}>{hint}</p>}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", background: "#0a0a0f", borderRadius: 6, padding: 3, gap: 2, border: "1px solid #1a1a2e" }}>
      {["claude", "opencode"].map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: "5px 14px", borderRadius: 4, border: "none", cursor: "pointer",
          fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: "0.05em",
          transition: "all 0.15s",
          background: value === opt ? "#ffffff15" : "transparent",
          color: value === opt ? "#fff" : "#555",
          boxShadow: value === opt ? "0 0 0 1px #ffffff22" : "none",
        }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function Pill({ n, active, color, onClick }) {
  return (
    <button onClick={() => onClick(n)} style={{
      width: 34, height: 34, borderRadius: 6,
      background: active ? `${color}22` : "#0a0a0f",
      border: `1px solid ${active ? color : "#1a1a2e"}`,
      color: active ? color : "#444",
      cursor: "pointer", fontFamily: mono, fontSize: 13, fontWeight: 700,
      transition: "all 0.15s",
    }}>{n}</button>
  );
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ position: "relative" }}>
      <button onClick={copy} style={{
        position: "absolute", top: 10, right: 10, zIndex: 2,
        background: copied ? "#00ff9d22" : "#ffffff11",
        border: `1px solid ${copied ? "#00ff9d" : "#ffffff22"}`,
        color: copied ? "#00ff9d" : "#666",
        padding: "3px 10px", borderRadius: 4, cursor: "pointer",
        fontFamily: mono, fontSize: 11, transition: "all 0.2s",
      }}>{copied ? "✓ copied" : "copy"}</button>
      <pre style={{
        background: "#0a0a0f", border: "1px solid #1a1a2e", borderRadius: 8,
        padding: "18px 16px", margin: 0, fontFamily: mono,
        fontSize: 12, lineHeight: 1.7, color: "#c9d1d9",
        overflowX: "auto", maxHeight: 440, overflowY: "auto",
      }}>{code}</pre>
    </div>
  );
}

// ─── Agent card ───────────────────────────────────────────────────────────────

function AgentCard({ role, config, onChange }) {
  const meta = AGENT_META[role];
  const [promptOpen, setPromptOpen] = useState(false);

  const set = (key, val) => onChange({ ...config, [key]: val });

  const handleCliChange = (cli) => {
    onChange({ ...config, cli, args: DEFAULT_ARGS[cli][role] });
  };

  // args stored as array in state, displayed as space-joined string
  const argsStr = Array.isArray(config.args) ? config.args.join(" ") : (config.args || "");
  const handleArgsChange = (str) => set("args", str.split(/\s+/).filter(Boolean));

  return (
    <div style={{
      background: "#0d0d1a", border: "1px solid #1a1a2e",
      borderTop: `2px solid ${meta.color}`, borderRadius: 10, padding: 24,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 60,
        background: `radial-gradient(ellipse at 50% -20%, ${meta.color}18 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>{meta.icon}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: sans }}>{meta.label}</span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "#555", fontFamily: mono }}>{meta.desc}</p>
        </div>
        <Toggle value={config.cli} onChange={handleCliChange} />
      </div>

      {/* Credentials */}
      <Field
        label={config.cli === "claude" ? "Anthropic API Key" : "API Key"}
        value={config.api_key || ""}
        onChange={v => set("api_key", v)}
        type="password"
        placeholder={config.cli === "claude" ? "sk-ant-..." : "your-private-key"}
        isCode
      />

      {config.cli === "opencode" && (
        <>
          <Field label="Base URL" value={config.base_url || ""} onChange={v => set("base_url", v)}
            placeholder="https://your-llm.internal/v1" isCode />
          <Field label="Model" value={config.model || ""} onChange={v => set("model", v)}
            placeholder="your-model-name" isCode />
        </>
      )}

      <Field label="CLI Args" value={argsStr} onChange={handleArgsChange}
        placeholder="--print --allowedTools Bash,Read,Write,Edit" isCode />

      {/* System prompt */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
          <label style={{ fontSize: 11, letterSpacing: "0.1em", color: "#555", textTransform: "uppercase", fontFamily: mono }}>
            System Prompt
          </label>
          <button onClick={() => setPromptOpen(o => !o)} style={{
            background: "none", border: "1px solid #1a1a2e", borderRadius: 4,
            color: "#555", cursor: "pointer", padding: "2px 8px", fontSize: 11, fontFamily: mono,
          }}>{promptOpen ? "collapse" : "expand"}</button>
        </div>
        {promptOpen ? (
          <textarea value={config.system_prompt || ""} onChange={e => set("system_prompt", e.target.value)}
            rows={12} style={{
              width: "100%", background: "#0a0a0f", border: "1px solid #1a1a2e",
              borderRadius: 6, padding: "10px 12px", color: "#c9d1d9",
              fontSize: 12, fontFamily: mono, outline: "none",
              boxSizing: "border-box", resize: "vertical",
            }}
            onFocus={e => (e.target.style.borderColor = "#ffffff33")}
            onBlur={e => (e.target.style.borderColor = "#1a1a2e")}
          />
        ) : (
          <div onClick={() => setPromptOpen(true)} style={{
            background: "#0a0a0f", border: "1px solid #1a1a2e", borderRadius: 6,
            padding: "10px 12px", color: "#444", fontSize: 12, fontFamily: mono,
            cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          }}>
            {(config.system_prompt || "").split("\n")[0]}…
          </div>
        )}
      </div>

      {/* Max fix rounds */}
      <div>
        <label style={{ fontSize: 11, letterSpacing: "0.1em", color: "#555", textTransform: "uppercase", fontFamily: mono, display: "block", marginBottom: 6 }}>
          Max Fix Rounds
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <Pill key={n} n={n} active={config.max_fix_rounds === n} color={meta.color}
              onClick={n => set("max_fix_rounds", n)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Export generators ────────────────────────────────────────────────────────

function generateDockerCompose(cfg) {
  const agentEnv = Object.entries(cfg.agents).map(([role, a]) => {
    if (a.cli === "claude") {
      return `      # ${role}\n      - ANTHROPIC_API_KEY_${role.toUpperCase()}=${a.api_key || ""}`;
    }
    return [
      `      # ${role}`,
      `      - OPENCODE_API_KEY_${role.toUpperCase()}=${a.api_key || ""}`,
      a.base_url ? `      - OPENCODE_BASE_URL_${role.toUpperCase()}=${a.base_url}` : null,
      a.model    ? `      - OPENCODE_MODEL_${role.toUpperCase()}=${a.model}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n");

  return `services:
  pipeline:
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - REDIS_ADDR=redis:6379
      - CONFIG_PATH=/data/config.json
${agentEnv}
    volumes:
      - pipeline_data:/data
      - workspaces:/workspaces
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes:
      - redis_data:/data

volumes:
  pipeline_data:
  workspaces:
  redis_data:
`;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [config, setConfig]     = useState(emptyConfig());
  const [tab, setTab]           = useState("agents");
  const [outputTab, setOutputTab] = useState("compose");
  const [loading, setLoading]   = useState(true);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [loadError, setLoadError] = useState(null);

  // Load config from backend on mount
  useEffect(() => {
    fetchConfig()
      .then(data => { setConfig(data); setLoading(false); })
      .catch(err => { setLoadError(err.message); setLoading(false); });
  }, []);

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    try {
      await postConfig(config);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }, [config]);

  const setAgent  = (role) => (val) => setConfig(c => ({ ...c, agents: { ...c.agents, [role]: val } }));
  const setGithub = (key)  => (val) => setConfig(c => ({ ...c, github: { ...c.github, [key]: val } }));
  const setPipeline = (key) => (val) => setConfig(c => ({ ...c, pipeline: { ...c.pipeline, [key]: val } }));

  const saveBtnStyle = {
    padding: "10px 24px",
    background: saveState === "saved" ? "#00ff9d22" : saveState === "error" ? "#ff000022" : "#ffffff0a",
    border: `1px solid ${saveState === "saved" ? "#00ff9d" : saveState === "error" ? "#ff4444" : "#ffffff22"}`,
    borderRadius: 8,
    color: saveState === "saved" ? "#00ff9d" : saveState === "error" ? "#ff4444" : "#fff",
    cursor: saveState === "saving" ? "wait" : "pointer",
    fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: "0.05em",
    transition: "all 0.2s",
  };

  const saveBtnLabel = { idle: "save config", saving: "saving...", saved: "✓ saved", error: "✗ error" }[saveState];

  const tabs = [
    { id: "agents",  label: "Agents" },
    { id: "github",  label: "GitHub" },
    { id: "export",  label: "Export" },
  ];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#070710", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#444", fontFamily: mono, fontSize: 13 }}>loading config...</p>
    </div>
  );

  if (loadError) return (
    <div style={{ minHeight: "100vh", background: "#070710", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "#ff4444", fontFamily: mono, fontSize: 13 }}>Cannot reach backend</p>
        <p style={{ color: "#444", fontFamily: mono, fontSize: 11 }}>{loadError}</p>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 12, padding: "8px 20px", background: "#ffffff0a",
          border: "1px solid #ffffff22", borderRadius: 6, color: "#fff",
          cursor: "pointer", fontFamily: mono, fontSize: 12,
        }}>retry</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#070710", color: "#c9d1d9", fontFamily: sans, padding: "32px 24px" }}>

      {/* ── Header ── */}
      <div style={{ maxWidth: 980, margin: "0 auto 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00ff9d", boxShadow: "0 0 8px #00ff9d" }} />
              <span style={{ fontSize: 11, letterSpacing: "0.2em", color: "#00ff9d", textTransform: "uppercase", fontFamily: mono }}>
                pipeline config
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
              AI Dev Pipeline
            </h1>
          </div>
          <button onClick={handleSave} style={saveBtnStyle}>{saveBtnLabel}</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", marginTop: 28, borderBottom: "1px solid #1a1a2e" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "10px 20px", background: "none", border: "none",
              borderBottom: `2px solid ${tab === t.id ? "#00d4ff" : "transparent"}`,
              color: tab === t.id ? "#00d4ff" : "#444",
              cursor: "pointer", fontFamily: mono, fontSize: 12, fontWeight: 600,
              letterSpacing: "0.08em", textTransform: "uppercase",
              transition: "all 0.15s", marginBottom: -1,
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto" }}>

        {/* ── AGENTS TAB ── */}
        {tab === "agents" && (
          <div>
            {/* Global max rounds */}
            <div style={{
              background: "#0d0d1a", border: "1px solid #1a1a2e", borderRadius: 10,
              padding: "16px 24px", marginBottom: 20,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <span style={{ fontSize: 13, color: "#888", fontFamily: mono }}>Global max fix rounds</span>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#444", fontFamily: mono }}>
                  Default for all agents unless overridden per-agent
                </p>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Pill key={n} n={n} active={config.pipeline.max_fix_rounds === n} color="#fff"
                    onClick={n => setPipeline("max_fix_rounds")(n)} />
                ))}
              </div>
            </div>

            {/* Agent cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {["developer", "tester", "reviewer"].map(role => (
                <AgentCard key={role} role={role} config={config.agents[role]} onChange={setAgent(role)} />
              ))}
            </div>

            {/* Pipeline flow */}
            <div style={{
              marginTop: 20, padding: "16px 24px",
              background: "#0d0d1a", border: "1px solid #1a1a2e", borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap",
            }}>
              {["developer", "tester", "reviewer"].map((role, i) => {
                const meta = AGENT_META[role];
                return (
                  <div key={role} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 6,
                      background: `${meta.color}11`, border: `1px solid ${meta.color}33`,
                    }}>
                      <span style={{ fontSize: 14 }}>{meta.icon}</span>
                      <span style={{ fontSize: 12, color: meta.color, fontFamily: mono, fontWeight: 600 }}>
                        {meta.label.toLowerCase()}
                      </span>
                      <span style={{ fontSize: 10, color: "#555", fontFamily: mono }}>
                        ({config.agents[role].cli})
                      </span>
                    </div>
                    {i < 2 && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        <span style={{ color: "#333", fontSize: 14 }}>→</span>
                        <span style={{ fontSize: 9, color: "#2a2a3a", fontFamily: mono }}>fix loop ↩</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── GITHUB TAB ── */}
        {tab === "github" && (
          <div style={{ maxWidth: 560 }}>

            {/* Token card */}
            <div style={{
              background: "#0d0d1a", border: "1px solid #1a1a2e",
              borderTop: "2px solid #00d4ff", borderRadius: 10, padding: 24, marginBottom: 16,
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 60,
                background: "radial-gradient(ellipse at 50% -20%, #00d4ff15 0%, transparent 70%)",
                pointerEvents: "none",
              }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>🔑</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: sans }}>GitHub Token</span>
              </div>
              <p style={{ margin: "0 0 16px", fontSize: 11, color: "#555", fontFamily: mono }}>
                Fine-grained personal access token — clone, push, PR, labels
              </p>

              <Field label="Token" value={config.github.token} onChange={setGithub("token")}
                type="password" placeholder="ghp_..." isCode />

              {/* Permissions checklist */}
              <div style={{ padding: "14px 16px", background: "#0a0a0f", borderRadius: 8, border: "1px solid #1a1a2e", marginBottom: 12 }}>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "#555", fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Permessi richiesti sul repo
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                  {[
                    ["Contents",      "Read & write", "clone + push"],
                    ["Pull requests", "Read & write", "apre la PR"],
                    ["Issues",        "Read & write", "label + commenti"],
                    ["Metadata",      "Read",         "obbligatorio"],
                  ].map(([scope, level, note]) => (
                    <div key={scope} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "#00ff9d", fontFamily: mono }}>✓</span>
                      <div>
                        <span style={{ fontSize: 11, color: "#c9d1d9", fontFamily: mono }}>{scope}</span>
                        <span style={{ fontSize: 10, color: "#555", fontFamily: mono }}> · {level}</span>
                        <div style={{ fontSize: 10, color: "#444", fontFamily: mono }}>{note}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "10px 0 0", paddingTop: 10, borderTop: "1px solid #1a1a2e", fontSize: 10, color: "#444", fontFamily: mono, lineHeight: 1.6 }}>
                  GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
                </p>
              </div>

              {config.github.token && (
                <div style={{ padding: "8px 12px", background: "#00d4ff08", borderRadius: 6, border: "1px solid #00d4ff22" }}>
                  <p style={{ margin: 0, fontSize: 11, fontFamily: mono, color: "#00d4ff88" }}>
                    clone via → <span style={{ color: "#00d4ff" }}>https://***@github.com/org/repo.git</span>
                  </p>
                </div>
              )}
            </div>

            {/* Webhook card */}
            <div style={{ background: "#0d0d1a", border: "1px solid #1a1a2e", borderRadius: 10, padding: 24, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 16 }}>⚡</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: sans }}>Webhook</span>
              </div>
              <Field label="Webhook Secret" value={config.github.webhook_secret}
                onChange={setGithub("webhook_secret")} type="password" placeholder="una stringa random lunga" isCode />
              <div style={{ padding: "12px 16px", background: "#0a0a0f", borderRadius: 8, border: "1px solid #1a1a2e" }}>
                <p style={{ margin: "0 0 6px", fontSize: 11, color: "#555", fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Configura su GitHub
                </p>
                <p style={{ margin: 0, fontSize: 11, color: "#555", fontFamily: mono, lineHeight: 1.8 }}>
                  repo → Settings → Webhooks → Add webhook<br />
                  Payload URL: <span style={{ color: "#00d4ff" }}>https://your-server:8080/webhook/github</span><br />
                  Content type: <span style={{ color: "#c9d1d9" }}>application/json</span><br />
                  Events: <span style={{ color: "#c9d1d9" }}>Issues</span>
                </p>
              </div>
            </div>

            {/* Pipeline settings */}
            <div style={{ background: "#0d0d1a", border: "1px solid #1a1a2e", borderRadius: 10, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 16 }}>⚙</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: sans }}>Pipeline Settings</span>
              </div>
              <Field label="Trigger Label" value={config.github.trigger_label}
                onChange={setGithub("trigger_label")} placeholder="ai-implement" isCode />
              <Field label="Base Branch" value={config.github.base_branch}
                onChange={setGithub("base_branch")} placeholder="main" isCode />
              <Field label="Workspaces Dir" value={config.pipeline.workspaces_dir}
                onChange={setPipeline("workspaces_dir")} placeholder="/workspaces" isCode />
              <div style={{ padding: "10px 14px", background: "#0a0a0f", borderRadius: 6, border: "1px solid #1a1a2e" }}>
                <p style={{ margin: 0, fontSize: 11, color: "#555", fontFamily: mono, lineHeight: 1.6 }}>
                  La pipeline si attiva quando la label{" "}
                  <span style={{ color: "#00ff9d" }}>"{config.github.trigger_label}"</span>{" "}
                  viene aggiunta a una issue.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── EXPORT TAB ── */}
        {tab === "export" && (
          <div>
            <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid #1a1a2e" }}>
              {["compose", "env"].map(t => (
                <button key={t} onClick={() => setOutputTab(t)} style={{
                  padding: "8px 18px", background: "none", border: "none",
                  borderBottom: `2px solid ${outputTab === t ? "#ff6b35" : "transparent"}`,
                  color: outputTab === t ? "#ff6b35" : "#444",
                  cursor: "pointer", fontFamily: mono, fontSize: 12, fontWeight: 600,
                  marginBottom: -1, transition: "all 0.15s",
                }}>
                  {t === "compose" ? "docker-compose.yml" : ".env"}
                </button>
              ))}
            </div>

            {outputTab === "compose" && <CodeBlock code={generateDockerCompose(config)} />}
            {outputTab === "env" && (
              <CodeBlock code={[
                "# GitHub",
                `GITHUB_TOKEN=${config.github.token || "ghp_..."}`,
                `GITHUB_WEBHOOK_SECRET=${config.github.webhook_secret || "your_secret"}`,
                "",
                "# Redis",
                "REDIS_ADDR=redis:6379",
              ].join("\n")} />
            )}

            <div style={{ marginTop: 16, padding: "14px 18px", background: "#0d0d1a", borderRadius: 8, border: "1px solid #1a1a2e" }}>
              <p style={{ margin: 0, fontSize: 11, color: "#555", fontFamily: mono, lineHeight: 1.9 }}>
                💡 La config viene salvata automaticamente in <span style={{ color: "#c9d1d9" }}>/data/config.json</span> (volume Docker).<br />
                Le API key sono già incluse nella config — non servono variabili d'ambiente per gli agenti.<br />
                1. Salva la config con il bottone <span style={{ color: "#00ff9d" }}>save config</span> in alto a destra<br />
                2. Copia il <span style={{ color: "#c9d1d9" }}>docker-compose.yml</span> nella root del progetto<br />
                3. Lancia <span style={{ color: "#00d4ff" }}>docker compose up -d</span>
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
