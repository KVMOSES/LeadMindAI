"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MessagesSquare,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { LiquidGlassButton } from "@/components/ui/liquid-glass-button";
import { LogoMark, LogoWordmark } from "@/components/lm/logo";

/**
 * SmokeLogin — split-screen authentication experience.
 *
 * Left panel: WebGL smoke animation (fbm domain-warped noise, brand violet /
 * indigo palette) with graceful degradation:
 *  - No WebGL / shader compile failure / context loss  → static brand gradient.
 *  - prefers-reduced-motion                            → static brand gradient.
 *  - Hidden tab                                        → RAF paused (no GPU work).
 *  - DPR capped, animation frames cancelled and all GL resources released on
 *    unmount.
 *
 * Right panel: paper-inspired form surface with grain texture, framer-motion
 * entrance (disabled under reduced motion), password visibility control,
 * inline accessible error reporting and a dark/light theme switch.
 *
 * Authentication is fully delegated to the `onSubmit` / `onDemo` callbacks —
 * this component never simulates success and never stores credentials beyond
 * the controlled form state used for submission.
 */

// ── Shaders ──────────────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_light;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = rot * p * 1.95 + vec2(3.1, 1.7);
    amp *= 0.52;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time * 0.05;

  vec2 q = vec2(
    fbm(p * 1.7 + vec2(0.0, t)),
    fbm(p * 1.7 + vec2(5.2, 1.3) - t * 0.7)
  );
  vec2 r = vec2(
    fbm(p * 1.8 + 2.1 * q + vec2(1.7, 9.2) + 0.35 * t),
    fbm(p * 1.8 + 2.1 * q + vec2(8.3, 2.8) - 0.22 * t)
  );
  float f = fbm(p * 1.5 + 2.4 * r);

  float smoke = smoothstep(0.30, 0.92, f);
  smoke += 0.16 * smoothstep(0.55, 1.0, r.y);
  smoke *= mix(0.5, 1.15, uv.y);

  vec3 darkBase = vec3(0.040, 0.047, 0.078);
  vec3 darkHi   = vec3(0.110, 0.120, 0.192);
  vec3 violet   = vec3(0.475, 0.400, 0.878);
  vec3 indigo   = vec3(0.360, 0.480, 0.878);

  vec3 lightBase = vec3(0.962, 0.961, 0.972);
  vec3 lightHi   = vec3(0.886, 0.882, 0.912);
  vec3 lViolet   = vec3(0.760, 0.722, 0.918);
  vec3 lIndigo   = vec3(0.706, 0.772, 0.928);

  vec3 base = mix(darkBase, lightBase, u_light);
  vec3 hi   = mix(darkHi, lightHi, u_light);
  vec3 cV   = mix(violet, lViolet, u_light);
  vec3 cI   = mix(indigo, lIndigo, u_light);

  vec3 col = mix(base, hi, smoothstep(0.0, 1.0, uv.y) * 0.85);
  float s1 = clamp(smoke * smoothstep(0.15, 0.9, q.y), 0.0, 1.0);
  float s2 = clamp(smoke * smoothstep(0.35, 1.05, r.x), 0.0, 1.0);
  col = mix(col, cV, s1 * (0.80 - 0.22 * u_light));
  col = mix(col, cI, s2 * (0.50 - 0.14 * u_light));

  float vig = smoothstep(1.35, 0.35, distance(uv, vec2(0.5)));
  col *= mix(0.62, 1.05, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ── WebGL smoke renderer ─────────────────────────────────────────────────────

interface SmokeRendererOpts {
  /** Reads the current light-mode target (0 = dark, 1 = light). */
  getLight: () => number;
  /** Called when the renderer fails or the GL context is lost. */
  onFail: () => void;
}

function createSmokeRenderer(canvas: HTMLCanvasElement, opts: SmokeRendererOpts): (() => void) | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    }) as WebGLRenderingContext | null) ?? (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
  } catch {
    return null;
  }
  if (!gl) return null;

  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }

  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uLight = gl.getUniformLocation(prog, "u_light");

  const dpr = Math.min(window.devicePixelRatio || 1, 1.35);
  let disposed = false;
  let raf = 0;
  let light = opts.getLight();
  const start = performance.now();

  const resize = () => {
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const render = (now: number) => {
    if (disposed) return;
    raf = window.requestAnimationFrame(render);
    if (document.hidden) return; // save GPU while the tab is in the background
    const target = opts.getLight();
    light += (target - light) * 0.045; // smooth theme cross-fade
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uLight, light);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  raf = window.requestAnimationFrame(render);

  const onContextLost = (e: Event) => {
    e.preventDefault();
    if (!disposed) opts.onFail();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener("webglcontextlost", onContextLost);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    const ext = gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  };
}

/** Static brand gradient shown while loading, on failure, or under reduced motion. */
function SmokeFallback({ light }: { light: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background: light
          ? "radial-gradient(120% 90% at 18% 8%, rgba(122,108,235,0.18), transparent 62%), radial-gradient(95% 85% at 82% 92%, rgba(88,124,235,0.14), transparent 65%), linear-gradient(158deg, #eceaf3 0%, #f5f4f8 55%, #e6e4ee 100%)"
          : "radial-gradient(120% 90% at 18% 8%, rgba(121,104,230,0.22), transparent 62%), radial-gradient(95% 85% at 82% 92%, rgba(70,110,226,0.16), transparent 65%), linear-gradient(158deg, #0a0c13 0%, #12141d 55%, #0d0f16 100%)",
      }}
    />
  );
}

const GRAIN_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E";

function Grain({ className, opacity }: { className?: string; opacity: number }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{ backgroundImage: GRAIN_URI, opacity }}
      />
  );
}

// ── Component ────────────────────────────────────────────────────────────────

const HIGHLIGHTS = [
  { icon: TrendingUp, text: "Explainable fit, intent and conversion predictions for every lead" },
  { icon: MessagesSquare, text: "Copilot answers grounded in live workspace data — never fabricated" },
  { icon: Sparkles, text: "Next-best actions with evidence, priorities and outcome learning" },
  { icon: ShieldCheck, text: "Workspace isolation, RBAC, audit logs and confirmation-gated actions" },
] as const;

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

export interface SmokeLoginProps {
  /** Submit credentials through the existing authentication endpoint. Throw to surface an inline error. */
  onSubmit: (email: string, password: string) => Promise<void>;
  /** Enter the existing demo environment. Throw to surface an inline error. */
  onDemo?: () => Promise<void>;
  /** Prefilled demo credentials shown as helper text / initial values. */
  demoEmail?: string;
  demoPassword?: string;
}

export function SmokeLogin({ onSubmit, onDemo, demoEmail = "", demoPassword = "" }: SmokeLoginProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const reduced = useReducedMotion();

  const [email, setEmail] = React.useState(demoEmail);
  const [password, setPassword] = React.useState(demoPassword);
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState<"login" | "demo" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [glFailed, setGlFailed] = React.useState(false);

  const isLight = resolvedTheme === "light";
  const smokeActive = !reduced && !glFailed;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!smokeActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cleanup = createSmokeRenderer(canvas, {
      getLight: () => (document.documentElement.classList.contains("dark") ? 0 : 1),
      onFail: () => setGlFailed(true),
    });
    if (!cleanup) {
      setGlFailed(true);
      return;
    }
    return cleanup;
  }, [smokeActive]);

  React.useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const run = async (kind: "login" | "demo", fn: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter both your email and password.");
      return;
    }
    void run("login", () => onSubmit(email.trim(), password));
  };

  const handleDemo = () => {
    if (!onDemo) return;
    void run("demo", onDemo);
  };

  const animate = !reduced;

  return (
    <div className="relative flex min-h-screen bg-background text-foreground">
      {/* ── Left: smoke brand panel ─────────────────────────────────────── */}
      <section
        className="relative hidden w-[52%] max-w-[760px] shrink-0 overflow-hidden lg:block"
        aria-label="LeadMind AI introduction"
      >
        <SmokeFallback light={isLight} />
        {smokeActive && (
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        )}
        <Grain opacity={isLight ? 0.035 : 0.06} className="mix-blend-overlay" />

        {/* Legibility scrim + content */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: isLight
              ? "linear-gradient(to right, rgba(245,244,248,0.55), rgba(245,244,248,0.12) 55%, transparent)"
              : "linear-gradient(to right, rgba(8,10,16,0.62), rgba(8,10,16,0.18) 55%, transparent)",
          }}
        />
        <motion.div
          className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14"
          variants={containerVariants}
          initial={animate ? "hidden" : false}
          animate="show"
        >
          <motion.div variants={animate ? itemVariants : undefined} className="flex items-center gap-3">
            <LogoMark size={40} />
            <LogoWordmark />
          </motion.div>

          <motion.div variants={animate ? itemVariants : undefined} className="max-w-xl">
            <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-tight xl:text-[2.85rem]">
              Stop staring at dashboards.
              <span className="lm-brand-text block">Ask your pipeline questions.</span>
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
              LeadMind combines customer-fit scoring, behavioural intent, calibrated conversion
              predictions and a copilot that investigates your real data on request — every answer
              traceable to the tools that produced it.
            </p>
          </motion.div>

          <motion.ul
            variants={animate ? itemVariants : undefined}
            className="grid max-w-xl gap-3 sm:grid-cols-2"
          >
            {HIGHLIGHTS.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lm-brand)]" aria-hidden="true" />
                <span>{f.text}</span>
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </section>

      {/* ── Right: auth panel ───────────────────────────────────────────── */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <Grain opacity={isLight ? 0.03 : 0.05} className="mix-blend-overlay" />

        {/* Top bar: mobile brand + theme switch */}
        <div className="relative z-10 flex items-center justify-between px-6 pt-6 sm:px-10">
          <div className="flex items-center gap-2.5 lg:invisible">
            <LogoMark size={30} />
            <p className="font-display text-sm font-bold tracking-tight">LeadMind AI</p>
          </div>
          <button
            type="button"
            onClick={() => setTheme(isLight ? "dark" : "light")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
          >
            {isLight ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>

        {/* Form */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <motion.div
            className="w-full max-w-[400px]"
            variants={containerVariants}
            initial={animate ? "hidden" : false}
            animate="show"
          >
            <motion.div variants={animate ? itemVariants : undefined}>
              <p className="lm-eyebrow mb-2">LeadMind workspace</p>
              <h2 className="font-display text-[26px] font-bold leading-tight tracking-tight">Welcome back</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Your sales intelligence workspace awaits.
              </p>
            </motion.div>

            {onDemo && (
              <motion.div variants={animate ? itemVariants : undefined} className="mt-7">
                <LiquidGlassButton
                  variant="brand"
                  size="lg"
                  className="w-full"
                  onClick={handleDemo}
                  disabled={busy !== null}
                  loading={busy === "demo"}
                >
                  {busy !== "demo" && <Sparkles className="size-4" aria-hidden="true" />}
                  {busy === "demo" ? "Preparing demo environment…" : "Enter demo mode"}
                </LiquidGlassButton>
                <div className="my-5 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or sign in</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              </motion.div>
            )}

            <motion.form variants={animate ? itemVariants : undefined} className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div className="space-y-1.5">
                <label htmlFor="smoke-email" className="text-sm font-medium">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    ref={emailRef}
                    id="smoke-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "smoke-error" : undefined}
                    className={cn(
                      "h-11 w-full rounded-lg border bg-background/60 pl-9 pr-3 text-sm shadow-sm outline-none backdrop-blur transition-[border-color,box-shadow]",
                      "placeholder:text-muted-foreground/70",
                      "focus-visible:border-[var(--lm-brand)]/50 focus-visible:ring-2 focus-visible:ring-[var(--lm-brand)]/25",
                      error && "border-destructive/60",
                    )}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="smoke-password" className="text-sm font-medium">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="smoke-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "smoke-error" : undefined}
                    className={cn(
                      "h-11 w-full rounded-lg border bg-background/60 pl-9 pr-11 text-sm shadow-sm outline-none backdrop-blur transition-[border-color,box-shadow]",
                      "placeholder:text-muted-foreground/70",
                      "focus-visible:border-[var(--lm-brand)]/50 focus-visible:ring-2 focus-visible:ring-[var(--lm-brand)]/25",
                      error && "border-destructive/60",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {error && (
                <motion.p
                  id="smoke-error"
                  role="alert"
                  initial={animate ? { opacity: 0, y: -4 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </motion.p>
              )}

              <LiquidGlassButton
                variant="brand"
                size="lg"
                type="submit"
                className="w-full"
                disabled={busy !== null}
                loading={busy === "login"}
              >
                {busy === "login" ? "Signing in…" : "Sign in"}
              </LiquidGlassButton>

              {(demoEmail || demoPassword) && (
                <p className="text-center text-xs text-muted-foreground">
                  Demo account: {demoEmail} / {demoPassword}
                </p>
              )}
            </motion.form>

            <motion.p
              variants={animate ? itemVariants : undefined}
              className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground"
            >
              Sessions are protected with httpOnly cookies. Role-based access control and audit
              logging apply to every workspace action.
            </motion.p>
          </motion.div>
        </div>

        {/* Loading veil while the session bootstraps */}
        {busy !== null && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2 pb-5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {busy === "demo" ? "Seeding demo workspace…" : "Verifying credentials…"}
          </div>
        )}
      </section>
    </div>
  );
}

export { SmokeLogin as default };
