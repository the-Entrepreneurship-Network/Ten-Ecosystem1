/**
 * Animated backdrops for the dashboard's portal sections.
 *
 * Two full-bleed shader backgrounds that alternate across the sixteen
 * sections, so opening "Daily Attendance" and opening "My Certificates" do not
 * look like the same screen with different words on it.
 *
 * WHY THIS IS PLAIN JS AND NOT THE REACT COMPONENTS IT CAME FROM
 *
 * The reference components were React + TypeScript + Tailwind, and the page
 * they have to live on — student-dashboard.html — is a 300KB vanilla HTML
 * document with no build step, no React and no Tailwind. Porting the two
 * shaders costs this one file; porting the dashboard to React would rewrite
 * the most-used page in the product to change a background.
 *
 * Two of the four references could not be used as-is at all:
 *
 *   - the WebGPU hero needs three/webgpu and a WebGPURenderer. WebGPU is not
 *     in Safari or Firefox stable, and it pulled its textures from a
 *     third-party image host. Behind a page students use daily that is a blank
 *     screen for a large share of them.
 *   - the energy beam injected a script from a CDN and rendered a scene hosted
 *     on someone else's servers. This repo is deliberately offline-first and
 *     ships no third-party script tags; that one is a hard no.
 *
 * So "crystal" is the neon-crystal-city raymarcher, toned down for use behind
 * text, and "beam" is a self-contained flowing-light field written here in the
 * same spirit as the energy beam, with nothing fetched from anywhere.
 *
 * COST CONTROL. This runs behind a working screen on hardware that is often a
 * budget laptop, so:
 *   - at most one canvas is ever alive — the section that is open
 *   - the buffer renders at ~55% of CSS size and is upscaled; a backdrop is
 *     blurred and dimmed anyway, so nobody can see the difference
 *   - the loop stops when the tab is hidden or the backdrop scrolls away
 *   - prefers-reduced-motion paints one frame and never animates
 *   - no WebGL, or a shader that will not compile, falls back to a CSS
 *     gradient rather than an empty black box
 */
(function (global) {
  'use strict';

  var VERT = '#version 300 es\n' +
    'in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

  /* ── crystal ───────────────────────────────────────────────────────────
     The neon city raymarcher. Step count is 48 rather than 100 and the fog
     closes in earlier: at backdrop opacity the far detail was invisible and
     was costing a third of the frame. */
  var FRAG_CRYSTAL = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse;\n' +
    'out vec4 fragColor;\n' +
    'const float TILE = 2.0, K = 0.5, MAXD = 60.0, SURF = 0.002;\n' +
    'float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }\n' +
    'float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b,a,h) - k*h*(1.0-h); }\n' +
    'float map(vec3 p){\n' +
    '  vec2 id = floor(p.xz / TILE);\n' +
    '  p.xz = mod(p.xz, TILE) - TILE*0.5;\n' +
    '  float n = fract(sin(dot(id, vec2(12.9898,78.233))) * 43758.5453);\n' +
    '  float h = 1.0 + n * 4.0;\n' +
    '  float b = sdBox(p - vec3(0.0, h - 1.0, 0.0), vec3(0.4, h, 0.4));\n' +
    '  if (n > 0.8) { float s = length(p - vec3(0.0, h*2.0, 0.0)) - 0.5; b = smin(b, s, K); }\n' +
    '  return min(b, p.y + 1.0);\n' +
    '}\n' +
    'vec3 palette(float t){ return vec3(0.5) + vec3(0.5)*cos(6.28318*(vec3(1.0,1.0,0.5)*t + vec3(0.85,0.92,0.35))); }\n' +
    'void main(){\n' +
    '  vec2 uv = (gl_FragCoord.xy*2.0 - u_res.xy) / u_res.y;\n' +
    '  vec3 ro = vec3(0.0, 0.0, u_time * 2.2);\n' +
    '  vec3 rd = normalize(vec3(uv, 1.0));\n' +
    '  float mx = (u_mouse.x - 0.5) * 0.7, my = (u_mouse.y - 0.5) * 0.35;\n' +
    '  mat3 rx = mat3(1.0,0.0,0.0, 0.0,cos(my),-sin(my), 0.0,sin(my),cos(my));\n' +
    '  mat3 ry = mat3(cos(mx),0.0,sin(mx), 0.0,1.0,0.0, -sin(mx),0.0,cos(mx));\n' +
    '  rd = ry * rx * rd;\n' +
    '  float d = 0.0;\n' +
    '  for (int i = 0; i < 48; i++) {\n' +
    '    float s = map(ro + rd*d); d += s;\n' +
    '    if (d > MAXD || abs(s) < SURF) break;\n' +
    '  }\n' +
    '  vec3 col = vec3(0.0);\n' +
    '  if (d < MAXD) {\n' +
    '    vec3 pos = ro + rd*d;\n' +
    '    vec2 id = floor(pos.xz / TILE);\n' +
    '    float n = fract(sin(id.x*157.0 + id.y*311.0) * 43758.5453);\n' +
    '    float lines = abs(fract(pos.y*2.0) - 0.5);\n' +
    '    col += palette(n + u_time*0.08) * pow(0.01/max(lines,1e-4), 1.5);\n' +
    '  }\n' +
    '  col = mix(col, vec3(0.004,0.008,0.03), smoothstep(0.0, MAXD*0.62, d));\n' +
    '  fragColor = vec4(col, 1.0);\n' +
    '}';

  /* ── beam ──────────────────────────────────────────────────────────────
     Slow vertical shafts of light drifting through haze, in TEN's gold
     against the navy the dashboard already uses. Cheap: no raymarching, a
     handful of sines and a value-noise fbm. */
  var FRAG_BEAM = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse;\n' +
    'out vec4 fragColor;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }\n' +
    'float noise(vec2 p){\n' +
    '  vec2 i = floor(p), f = fract(p);\n' +
    '  vec2 u = f*f*(3.0-2.0*f);\n' +
    '  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);\n' +
    '}\n' +
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i=0;i<4;i++){ v += a*noise(p); p *= 2.02; a *= 0.5; } return v; }\n' +
    'void main(){\n' +
    '  vec2 uv = gl_FragCoord.xy / u_res.xy;\n' +
    '  vec2 c = (gl_FragCoord.xy*2.0 - u_res.xy) / u_res.y;\n' +
    '  float t = u_time * 0.09;\n' +
    '  float par = (u_mouse.x - 0.5) * 0.28;\n' +
    '  float beams = 0.0;\n' +
    '  for (int i = 0; i < 5; i++) {\n' +
    '    float fi = float(i);\n' +
    '    float x = sin(t*1.4 + fi*1.9) * 0.85 + par * (0.5 + fi*0.16);\n' +
    '    float w = 0.030 + 0.020 * sin(t*2.1 + fi);\n' +
    /* w/(d+w) rather than w/d. The reciprocal has no ceiling: a beam crossing
       the middle of the screen went to pure white exactly where the section
       heading sits. This peaks at 1 and squaring it keeps the core tight. */
    '    float band = w / (abs(c.x - x) + w);\n' +
    '    band *= band;\n' +
    '    band *= smoothstep(1.25, 0.05, abs(c.y));\n' +
    '    beams += band * (0.42 + 0.30 * sin(t*3.0 + fi*2.4));\n' +
    '  }\n' +
    '  beams = min(beams, 1.5);\n' +
    '  float haze = fbm(vec2(c.x*1.4, c.y*0.85 - t*2.4)) * 0.30;\n' +
    '  vec3 gold = vec3(0.83, 0.69, 0.22);\n' +
    '  vec3 deep = vec3(0.012, 0.024, 0.062);\n' +
    '  vec3 col = deep + gold * beams * 0.30 + gold * haze * 0.12;\n' +
    '  col *= 1.0 - 0.55 * length(uv - 0.5);\n' +   /* vignette, so text over the middle stays readable */
    '  fragColor = vec4(col, 1.0);\n' +
    '}';

  var SHADERS = { crystal: FRAG_CRYSTAL, beam: FRAG_BEAM };

  /* The look each variant falls back to, and the scrim painted over the live
     canvas. Same colours either way, so a fallback is a quieter version of the
     backdrop rather than a different design. */
  var FALLBACK = {
    crystal: 'radial-gradient(120% 90% at 50% 0%, #10193a 0%, #060913 55%, #04060f 100%)',
    beam:    'radial-gradient(100% 80% at 50% 110%, #2a2413 0%, #0a1024 45%, #04060f 100%)'
  };

  function prefersReducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[backdrop] shader failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  /**
   * Mount a backdrop into `host`. Returns a handle with .destroy().
   * Never throws: a failure paints the gradient and reports success anyway,
   * because a section that will not open is worse than a flat background.
   */
  function mount(host, variant) {
    if (!host) return { destroy: function () {} };
    variant = SHADERS[variant] ? variant : 'crystal';

    var layer = document.createElement('div');
    layer.className = 'portal-backdrop';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText =
      'position:absolute; inset:0; z-index:0; overflow:hidden; pointer-events:none; ' +
      'background:' + FALLBACK[variant] + ';';

    // Content must sit above this, and the host has to be a containing block.
    var hostPos = global.getComputedStyle(host).position;
    if (hostPos === 'static') host.style.position = 'relative';
    host.insertBefore(layer, host.firstChild);

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block; width:100%; height:100%; opacity:.42; ' +
      'filter:blur(.4px) saturate(1.05);';
    var gl = null;
    try { gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' }); }
    catch (e) { gl = null; }

    if (!gl) return finish();               // no WebGL2: the gradient is the backdrop

    var prog = gl.createProgram();
    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, SHADERS[variant]);
    if (!vs || !fs) return finish();

    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[backdrop] link failed:', gl.getProgramInfoLog(prog));
      return finish();
    }

    layer.appendChild(canvas);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes   = gl.getUniformLocation(prog, 'u_res');
    var uTime  = gl.getUniformLocation(prog, 'u_time');
    var uMouse = gl.getUniformLocation(prog, 'u_mouse');

    var mouse = { x: 0.5, y: 0.5 };
    var started = Date.now();
    var raf = null;
    var dead = false;
    var onScreen = true;

    /* 55% of CSS pixels. The result is blurred and at 42% opacity; the pixels
       nobody can see are the cheapest ones not to draw. */
    var SCALE = 0.55;
    function resize() {
      var w = Math.max(1, Math.round(layer.clientWidth  * SCALE));
      var h = Math.max(1, Math.round(layer.clientHeight * SCALE));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }

    function draw() {
      if (dead) return;
      resize();
      gl.useProgram(prog);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (Date.now() - started) * 0.001);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function loop() {
      if (dead) return;
      draw();
      raf = global.requestAnimationFrame(loop);
    }

    function play() {
      if (dead || raf !== null || !onScreen || document.hidden) return;
      raf = global.requestAnimationFrame(loop);
    }
    function pause() {
      if (raf !== null) { global.cancelAnimationFrame(raf); raf = null; }
    }

    function onMove(e) {
      var r = layer.getBoundingClientRect();
      if (!r.width || !r.height) return;
      mouse.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      mouse.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    }
    function onVisibility() { document.hidden ? pause() : play(); }

    var io = null;
    if (global.IntersectionObserver) {
      io = new global.IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        onScreen ? play() : pause();
      }, { threshold: 0 });
      io.observe(layer);
    }

    var ro = null;
    if (global.ResizeObserver) {
      ro = new global.ResizeObserver(function () { if (!raf) draw(); });
      ro.observe(layer);
    }

    /* Paint one frame straight away, before any of the loop machinery.
       requestAnimationFrame does not fire in a tab the browser is not
       compositing, and a backdrop that stays black until the tab is focused
       is worse than a still one. This also IS the reduced-motion rendering. */
    draw();

    if (!prefersReducedMotion()) {
      global.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      play();
    }

    return {
      variant: variant,
      element: layer,
      redraw: draw,
      destroy: function () {
        dead = true;
        pause();
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        global.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVisibility);
        try {
          var lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (e) {}
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }
    };

    function finish() {
      return {
        variant: variant,
        element: layer,
        degraded: true,
        destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }
      };
    }
  }

  /* One backdrop alive at a time. Sixteen live raymarchers would be sixteen
     render loops competing for the same GPU to draw fifteen things nobody is
     looking at. */
  var current = null;

  function show(host, variant) {
    if (current) { current.destroy(); current = null; }
    current = mount(host, variant);
    return current;
  }

  function clear() {
    if (current) { current.destroy(); current = null; }
  }

  /** Alternate by position, so neighbouring sections never share a look. */
  function variantFor(index) {
    return (index % 2 === 0) ? 'crystal' : 'beam';
  }

  global.PortalBackdrop = {
    mount: mount,
    show: show,
    clear: clear,
    variantFor: variantFor,
    variants: Object.keys(SHADERS)
  };
})(window);
