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
    'uniform vec3 u_tint; uniform float u_seed;\n' +
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
    '    col += palette(n + u_seed + u_time*0.08) * u_tint * pow(0.01/max(lines,1e-4), 1.5);\n' +
    '  }\n' +
    '  col = mix(col, vec3(0.02,0.035,0.09), smoothstep(0.0, MAXD*0.62, d));\n' +
    /* Ambient lift. The raw scene is a night city and measured a mean
       brightness of 8/255 — technically rendering, visually black. A sky
       gradient and a gold ground bounce put it in the same range as the other
       three so the rotation reads as four looks, not one look and three gaps. */
    '  float sky = smoothstep(0.85, -0.35, uv.y);\n' +
    '  col += vec3(0.035,0.055,0.13) * mix(vec3(1.0), u_tint, 0.65) * sky;\n' +
    '  col += vec3(0.16,0.13,0.05) * u_tint * pow(max(0.0, -uv.y), 1.6) * 0.55;\n' +
    '  fragColor = vec4(col, 1.0);\n' +
    '}';

  /* ── beam ──────────────────────────────────────────────────────────────
     Slow vertical shafts of light drifting through haze, in TEN's gold
     against the navy the dashboard already uses. Cheap: no raymarching, a
     handful of sines and a value-noise fbm. */
  var FRAG_BEAM = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse;\n' +
    'uniform vec3 u_tint; uniform float u_seed;\n' +
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
    '    float x = sin(t*1.4 + fi*1.9 + u_seed*6.283) * 0.85 + par * (0.5 + fi*0.16);\n' +
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
    '  vec3 gold = u_tint;\n' +
    /* Lifted from near-black for the same reason as the crystal shader: at a
       mean of 9/255 the beams had nothing to stand against. */
    '  vec3 deep = mix(vec3(0.030, 0.048, 0.105), vec3(0.055, 0.045, 0.030), smoothstep(0.9, -0.2, c.y));\n' +
    '  vec3 col = deep + gold * beams * 0.42 + gold * haze * 0.26;\n' +
    '  col *= 1.0 - 0.55 * length(uv - 0.5);\n' +   /* vignette, so text over the middle stays readable */
    '  fragColor = vec4(col, 1.0);\n' +
    '}';

  /* ── scan ──────────────────────────────────────────────────────────────
     The third reference — the "futuristic hero" — reproduced in plain WebGL2.
     The original needed WebGPU (absent from Safari and Firefox stable) and
     pulled a photograph and its depth map off a third-party image host. What
     actually made it look the way it does is a dot-matrix over a depth field,
     a scan line travelling through that depth, red bleeding out along the
     scan, and bloom. All four survive here with no WebGPU and nothing
     fetched: the depth comes from procedural fbm instead of a photograph. */
  var FRAG_SCAN = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse;\n' +
    'uniform vec3 u_tint; uniform float u_seed;\n' +
    'out vec4 fragColor;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }\n' +
    'float vnoise(vec2 p){\n' +
    '  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);\n' +
    '  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);\n' +
    '}\n' +
    'float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }\n' +
    'void main(){\n' +
    '  vec2 uv = gl_FragCoord.xy / u_res.xy;\n' +
    '  float par = (u_mouse.x - 0.5) * 0.04;\n' +
    /* Stand-in for the depth map the original downloaded. */
    '  float depth = fbm(vec2(uv.x*2.6 + par, uv.y*2.6) + 11.0 + u_seed*37.0);\n' +
    '  depth = smoothstep(0.18, 0.86, depth);\n' +
    /* The dot matrix: cell centres, brightness from a second noise field. */
    '  float aspect = u_res.x / u_res.y;\n' +
    '  vec2 tuv = vec2(uv.x*aspect, uv.y);\n' +
    '  vec2 tiling = vec2(150.0);\n' +
    '  vec2 cell = fract(tuv*tiling) * 2.0 - 1.0;\n' +
    '  float bright = vnoise(floor(tuv*tiling));\n' +
    '  float dots = smoothstep(0.62, 0.54, length(cell)) * bright;\n' +
    /* The scan line sweeps the depth field, not the screen, so it wraps
       around whatever the depth says is close. */
    '  float prog = sin(u_time*0.5)*0.5 + 0.5;\n' +
    '  float flow = 1.0 - smoothstep(0.0, 0.035, abs(depth - prog));\n' +
    '  vec3 mask = vec3(dots * flow) * (u_tint * 1.9);\n' +
    /* Base plate: a cool depth-shaded ground with a gold horizon lift, so it
       belongs to TEN rather than to the reference. */
    '  vec3 base = mix(vec3(0.008,0.014,0.036), vec3(0.05,0.07,0.15), depth);\n' +
    '  base += vec3(0.30,0.24,0.08) * pow(1.0-uv.y, 3.0) * 0.35;\n' +
    /* Screen blend, as the original did, then a cheap bloom: the mask bled
       through a wide, low-frequency sample of itself. */
    '  vec3 col = 1.0 - (1.0 - base) * (1.0 - mask);\n' +
    '  float halo = (1.0 - smoothstep(0.0, 0.16, abs(depth - prog))) * bright;\n' +
    '  col += vec3(0.9,0.16,0.20) * halo * 0.16;\n' +
    '  col *= 1.0 - 0.42 * length(uv - 0.5);\n' +
    '  fragColor = vec4(col, 1.0);\n' +
    '}';

  /* ── wave ──────────────────────────────────────────────────────────────
     The particle wave: a ground plane of points rippling on a sine field,
     seen from a low camera. The reference built it on three.js; the whole of
     what three.js was doing here is one view-projection matrix and a points
     draw, and the camera never moves, so the matrix is folded into the vertex
     shader as constants and the dependency disappears.

     The grid is 120x120 (14,400 points) rather than the reference's 200x200
     (40,000). Behind content at backdrop scale the extra 25,000 points are
     not visible, and they are a third of the vertex work. */
  var VERT_WAVE = '#version 300 es\n' +
    'in vec2 a_grid;\n' +          /* grid index, 0..1 in each axis */
    'uniform float u_time; uniform float u_aspect; uniform vec2 u_mouse;\n' +
    'uniform float u_seed;\n' +
    'out float v_fade;\n' +
    /* Camera fixed at (0,6,5) looking at the origin, so the view basis is
       constant: right (1,0,0), up (0,0.6402,-0.7682), forward (0,-0.7682,-0.6402). */
    'const vec3 EYE = vec3(0.0, 6.0, 5.0);\n' +
    'const vec3 R = vec3(1.0, 0.0, 0.0);\n' +
    'const vec3 U = vec3(0.0, 0.6402, -0.7682);\n' +
    'const vec3 F = vec3(0.0, -0.7682, -0.6402);\n' +
    'const float FOCAL = 1.3032;\n' +   /* 1/tan(75deg/2) */
    'void main(){\n' +
    '  float span = 36.0;\n' +
    '  vec3 p = vec3((a_grid.x - 0.5) * span, 0.0, (a_grid.y - 0.5) * span);\n' +
    '  float t = u_time + u_seed * 12.0;\n' +
    /* The reference's displacement, kept as written. */
    '  p.y += (sin(p.x + t) * 0.5) + (cos(p.z + t) * 0.1) * 2.0;\n' +
    '  p.x += (sin(p.z + t) * 0.5);\n' +
    /* A gentle swell under the pointer, so the field answers the cursor. */
    '  vec2 mw = (u_mouse - 0.5) * vec2(span, span) * vec2(1.0, -1.0);\n' +
    '  float md = length(p.xz - mw);\n' +
    '  p.y += exp(-md * md * 0.012) * 1.9;\n' +
    '  float s = 1.0 + (sin(p.x + t) * 0.5) + (cos(p.z + t) * 0.1) * 2.0;\n' +
    '  vec3 rel = p - EYE;\n' +
    /* Third row is -F, not F. View space looks down -Z: with dot(F, rel) the
       centre of the grid came out at v.z = +7.81, so w = -v.z was negative,
       every point failed the -w <= z <= w clip test, and the field drew
       nothing at all — a frame measuring exactly its own clear colour. */
    '  vec3 v = vec3(dot(R, rel), dot(U, rel), dot(-F, rel));\n' +
    '  float w = -v.z;\n' +
    '  gl_Position = vec4(v.x * FOCAL / u_aspect, v.y * FOCAL, -v.z * 0.998 - 0.02, w);\n' +
    /* Bigger than the reference's sprite. Measured, the field came out at a
       mean of 8/255 — barely above the clear colour, because at backdrop
       scale the points were sub-pixel for most of the grid. */
    '  gl_PointSize = clamp(s * 26.0 / max(w, 0.35), 1.2, 13.0);\n' +
    /* Points fade out with distance so the far edge dissolves rather than
       ending in a hard line. */
    '  v_fade = clamp(1.0 - w / 46.0, 0.0, 1.0);\n' +
    '}';

  var FRAG_WAVE = '#version 300 es\n' +
    'precision highp float;\n' +
    'in float v_fade; uniform vec3 u_tint;\n' +
    'out vec4 fragColor;\n' +
    'void main(){\n' +
    /* Round the square point sprite off, or the field reads as confetti. */
    '  float d = length(gl_PointCoord - 0.5);\n' +
    '  float a = smoothstep(0.5, 0.10, d) * v_fade * 0.95;\n' +
    '  if (a < 0.01) discard;\n' +
    '  fragColor = vec4(u_tint * (0.70 + v_fade * 0.95), a);\n' +
    '}';

  var SHADERS = { crystal: FRAG_CRYSTAL, beam: FRAG_BEAM, scan: FRAG_SCAN };

  /* The look each variant falls back to, and the scrim painted over the live
     canvas. Same colours either way, so a fallback is a quieter version of the
     backdrop rather than a different design. */
  var FALLBACK = {
    crystal: 'radial-gradient(120% 90% at 50% 0%, #10193a 0%, #060913 55%, #04060f 100%)',
    beam:    'radial-gradient(100% 80% at 50% 110%, #2a2413 0%, #0a1024 45%, #04060f 100%)',
    scan:    'radial-gradient(120% 100% at 50% 100%, #241016 0%, #0b1024 48%, #04060f 100%)',
    voxel:   'radial-gradient(120% 100% at 50% 30%, #191a2c 0%, #090d1c 52%, #04060f 100%)',
    paths:   'radial-gradient(110% 90% at 20% 20%, #101a2e 0%, #070b18 55%, #04060f 100%)',
    wave:    'radial-gradient(120% 90% at 50% 80%, #0d1730 0%, #070c1c 50%, #04060f 100%)'
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

  /* ── voxel ─────────────────────────────────────────────────────────────
     The isometric topography field, in Canvas 2D exactly as the reference
     draws it: a height wave per tile, a cursor bulge, painter's-algorithm
     back-to-front, a colour lookup table so the loop allocates nothing, and
     screen-space culling.
     Recoloured from indigo to TEN's gold-over-navy, and the tiles are larger
     than the reference's 28px — as a backdrop it wants to read as terrain
     from across the room, and bigger tiles mean far fewer of them to draw. */
  function mountVoxel(layer, tint, seed) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block; width:100%; height:100%;';
    var ctx = null;
    try { ctx = canvas.getContext('2d', { alpha: false }); } catch (e) { ctx = null; }
    if (!ctx) {
      return { variant: 'voxel', element: layer, degraded: true,
        destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); } };
    }
    layer.appendChild(canvas);

    var TILE = 42, MAXH = 74, SPEED = 0.013;
    var tileW = TILE * 0.866025, tileH = TILE * 0.5;
    var RADIUS = 230, radiusSq = RADIUS * RADIUS;
    var invMaxH = 1 / (MAXH + 55);

    tint = tint || [0.83, 0.69, 0.22];
    seed = seed || 0;
    var base = { r: (tint[0] * 255) | 0, g: (tint[1] * 255) | 0, b: (tint[2] * 255) | 0 };
    var leftFace  = 'rgba(' + ((base.r * 0.30) | 0) + ',' + ((base.g * 0.30) | 0) + ',' + ((base.b * 0.34) | 0) + ',.92)';
    var rightFace = 'rgba(' + ((base.r * 0.46) | 0) + ',' + ((base.g * 0.44) | 0) + ',' + ((base.b * 0.40) | 0) + ',.92)';
    var wire = 'rgba(' + base.r + ',' + base.g + ',' + base.b + ',.20)';
    var phase = seed * 6.283;

    /* Darker than the reference's 0.55-1.0 ramp. Measured against the other
       three this field came out at a mean of 80/255 — a bright midtone across
       the whole frame, which is a lot to put behind body text even with
       panels over it. This lands it in the same band as the shaders. */
    var LUT = new Array(101);
    for (var i = 0; i <= 100; i++) {
      var ratio = i / 100;
      /* Scaled down again after the per-portal tints landed: a bright tint
         such as the coding section's cyan pushed the whole field back up to a
         mean of 86/255. */
      LUT[i] = 'rgb(' +
        ((base.r * (0.07 + ratio * 0.30)) | 0) + ',' +
        ((base.g * (0.08 + ratio * 0.28)) | 0) + ',' +
        ((base.b * (0.22 + ratio * 0.24)) | 0) + ')';
    }

    var w = 0, h = 0, t = 0, dpr = 1;
    var mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };
    var raf = null, dead = false, onScreen = true;

    function resize() {
      dpr = Math.min(global.devicePixelRatio || 1, 1.5);
      w = layer.clientWidth; h = layer.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      if (dead || !w || !h) { resize(); if (!w || !h) return; }
      t += SPEED;
      mouse.x += (mouse.tx - mouse.x) * 0.32;
      mouse.y += (mouse.ty - mouse.y) * 0.32;

      ctx.fillStyle = '#04060f';
      ctx.fillRect(0, 0, w, h);

      var cols = Math.ceil(w / tileW) + 4, rows = Math.ceil(h / tileH) + 8;
      var ox = w * 0.5, oy = h / 3.2;
      var r0 = -Math.floor(rows / 2), r1 = Math.ceil(rows / 2);
      var c0 = -Math.floor(cols / 2), c1 = Math.ceil(cols / 2);

      for (var r = r0; r < r1; r++) {
        for (var c = c0; c < c1; c++) {
          var isoX = ox + (c - r) * tileW;
          var isoY = oy + (c + r) * tileH;

          var hh = (Math.sin(t * 2 + phase + c * 0.25 + r * 0.25) + Math.cos(t * 1.5 + phase + c * 0.15 - r * 0.3) + 2) * 0.25 * MAXH;

          var dx = isoX - mouse.x, dy = isoY - mouse.y;
          var dsq = dx * dx + dy * dy;
          if (dsq < radiusSq) {
            var inf = 1 - Math.sqrt(dsq) / RADIUS;
            hh += inf * inf * 55;
          }

          var py = isoY - hh;
          if (isoX + tileW < 0 || isoX - tileW > w || py + hh + 15 < 0 || py - tileH > h) continue;

          var shift = hh + 15;
          ctx.beginPath();
          ctx.moveTo(isoX - tileW, py);
          ctx.lineTo(isoX, py + tileH);
          ctx.lineTo(isoX, py + tileH + shift);
          ctx.lineTo(isoX - tileW, py + shift);
          ctx.closePath();
          ctx.fillStyle = leftFace; ctx.fill();

          ctx.beginPath();
          ctx.moveTo(isoX, py + tileH);
          ctx.lineTo(isoX + tileW, py);
          ctx.lineTo(isoX + tileW, py + shift);
          ctx.lineTo(isoX, py + tileH + shift);
          ctx.closePath();
          ctx.fillStyle = rightFace; ctx.fill();

          ctx.beginPath();
          ctx.moveTo(isoX, py - tileH);
          ctx.lineTo(isoX + tileW, py);
          ctx.lineTo(isoX, py + tileH);
          ctx.lineTo(isoX - tileW, py);
          ctx.closePath();
          var lit = hh * invMaxH;
          ctx.fillStyle = LUT[((lit > 1 ? 1 : lit < 0.1 ? 0.1 : lit) * 100) | 0];
          ctx.fill();
          ctx.strokeStyle = wire; ctx.lineWidth = 0.6; ctx.stroke();
        }
      }
    }

    function loop() { if (dead) return; draw(); raf = global.requestAnimationFrame(loop); }
    function play() { if (dead || raf !== null || !onScreen || document.hidden) return; raf = global.requestAnimationFrame(loop); }
    function pause() { if (raf !== null) { global.cancelAnimationFrame(raf); raf = null; } }

    function onMove(e) {
      var rect = layer.getBoundingClientRect();
      mouse.tx = e.clientX - rect.left;
      mouse.ty = e.clientY - rect.top;
    }
    function onVisibility() { document.hidden ? pause() : play(); }

    var io = null;
    if (global.IntersectionObserver) {
      io = new global.IntersectionObserver(function (en) { onScreen = en[0].isIntersecting; onScreen ? play() : pause(); }, { threshold: 0 });
      io.observe(layer);
    }
    var ro = null;
    if (global.ResizeObserver) {
      ro = new global.ResizeObserver(function () { resize(); if (!raf) draw(); });
      ro.observe(layer);
    }

    resize();
    draw();
    if (!prefersReducedMotion()) {
      global.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      play();
    }

    return {
      variant: 'voxel',
      element: layer,
      redraw: draw,
      destroy: function () {
        dead = true; pause();
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        global.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVisibility);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }
    };
  }

  /* The particle wave draws a grid of points rather than one quad, so it gets
     its own mount rather than sharing the fullscreen-quad path. */
  function mountWave(layer, tint, seed) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block; width:100%; height:100%;';
    var gl = null;
    try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'low-power' }); }
    catch (e) { gl = null; }
    if (!gl) {
      return { variant: 'wave', element: layer, degraded: true,
        destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); } };
    }

    var vs = compile(gl, gl.VERTEX_SHADER, VERT_WAVE);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_WAVE);
    if (!vs || !fs) {
      return { variant: 'wave', element: layer, degraded: true,
        destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); } };
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[backdrop] wave link failed:', gl.getProgramInfoLog(prog));
      return { variant: 'wave', element: layer, degraded: true,
        destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); } };
    }
    layer.appendChild(canvas);

    var N = 120;                                   // 14,400 points
    var grid = new Float32Array(N * N * 2);
    var k = 0;
    for (var ix = 0; ix < N; ix++) {
      for (var iy = 0; iy < N; iy++) {
        grid[k++] = ix / (N - 1);
        grid[k++] = iy / (N - 1);
      }
    }
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
    var aGrid = gl.getAttribLocation(prog, 'a_grid');
    gl.enableVertexAttribArray(aGrid);
    gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, 'u_time');
    var uAspect = gl.getUniformLocation(prog, 'u_aspect');
    var uMouse = gl.getUniformLocation(prog, 'u_mouse');
    var uTint = gl.getUniformLocation(prog, 'u_tint');
    var uSeed = gl.getUniformLocation(prog, 'u_seed');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    var mouse = { x: 0.5, y: 0.5 }, started = Date.now();
    var raf = null, dead = false, onScreen = true;
    var SCALE = 0.7;

    function resize() {
      var w = Math.max(1, Math.round(layer.clientWidth * SCALE));
      var h = Math.max(1, Math.round(layer.clientHeight * SCALE));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    function draw() {
      if (dead) return;
      resize();
      gl.clearColor(0.016, 0.024, 0.059, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform1f(uTime, (Date.now() - started) * 0.001 * 1.0);
      gl.uniform1f(uAspect, canvas.width / Math.max(canvas.height, 1));
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      gl.uniform1f(uSeed, seed);
      gl.drawArrays(gl.POINTS, 0, N * N);
    }
    function loop() { if (dead) return; draw(); raf = global.requestAnimationFrame(loop); }
    function play() { if (dead || raf !== null || !onScreen || document.hidden) return; raf = global.requestAnimationFrame(loop); }
    function pause() { if (raf !== null) { global.cancelAnimationFrame(raf); raf = null; } }
    function onMove(e) {
      var r = layer.getBoundingClientRect();
      if (!r.width || !r.height) return;
      mouse.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      mouse.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    }
    function onVisibility() { document.hidden ? pause() : play(); }

    var io = null;
    if (global.IntersectionObserver) {
      io = new global.IntersectionObserver(function (en) { onScreen = en[0].isIntersecting; onScreen ? play() : pause(); }, { threshold: 0 });
      io.observe(layer);
    }
    var ro = null;
    if (global.ResizeObserver) { ro = new global.ResizeObserver(function () { if (!raf) draw(); }); ro.observe(layer); }

    draw();
    if (!prefersReducedMotion()) {
      global.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
      play();
    }

    return {
      variant: 'wave',
      element: layer,
      redraw: draw,
      destroy: function () {
        dead = true; pause();
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        global.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVisibility);
        try { var l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); } catch (e) {}
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }
    };
  }

  /* ── paths ─────────────────────────────────────────────────────────────
     The floating paths: thirty-six long curves drifting across the frame.
     The reference animated each one with motion/react; the animation is a
     stroke travelling along a path, which is what stroke-dasharray and
     stroke-dashoffset do natively. So this is SVG and CSS with no script in
     the frame at all — no canvas, no render loop, and nothing for the GPU to
     do between repaints. It is by far the cheapest of the six, which is why
     it goes to the sections with the longest reading. */
  function mountPaths(layer, tint, seed) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 696 316');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('fill', 'none');
    svg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';

    var rgb = 'rgb(' + ((tint[0] * 255) | 0) + ',' + ((tint[1] * 255) | 0) + ',' + ((tint[2] * 255) | 0) + ')';
    // A seed of 0..1 becomes a direction and a spread, so two portals using
    // this engine do not draw the same curves.
    var position = seed < 0.5 ? 1 : -1;
    var still = prefersReducedMotion();

    for (var i = 0; i < 36; i++) {
      var x0 = 380 - i * 5 * position;
      var y0 = 189 + i * 6;
      var d = 'M-' + x0 + ' -' + y0 +
        'C-' + x0 + ' -' + y0 +
        ' -' + (312 - i * 5 * position) + ' ' + (216 - i * 6) +
        ' ' + (152 - i * 5 * position) + ' ' + (343 - i * 6) +
        'C' + (616 - i * 5 * position) + ' ' + (470 - i * 6) +
        ' ' + (684 - i * 5 * position) + ' ' + (875 - i * 6) +
        ' ' + (684 - i * 5 * position) + ' ' + (875 - i * 6);

      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke', rgb);
      p.setAttribute('stroke-width', String(0.5 + i * 0.06));
      p.setAttribute('stroke-opacity', String(Math.min(0.55, 0.08 + i * 0.022)));
      if (!still) {
        p.style.strokeDasharray = '820 820';
        p.style.animation = 'tenPathDrift ' + (20 + (i * 7 + seed * 130) % 11) + 's linear infinite';
        p.style.animationDelay = '-' + ((i * 1.7 + seed * 20) % 22).toFixed(2) + 's';
      }
      svg.appendChild(p);
    }

    if (!document.getElementById('tenPathDriftKeyframes')) {
      var st = document.createElement('style');
      st.id = 'tenPathDriftKeyframes';
      st.textContent =
        '@keyframes tenPathDrift{' +
        '0%{stroke-dashoffset:820;opacity:.25}' +
        '50%{opacity:.65}' +
        '100%{stroke-dashoffset:-820;opacity:.25}}';
      document.head.appendChild(st);
    }

    layer.appendChild(svg);
    return {
      variant: 'paths',
      element: layer,
      redraw: function () {},
      destroy: function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }
    };
  }

  /**
   * Mount a backdrop into `host`. Returns a handle with .destroy().
   * Never throws: a failure paints the gradient and reports success anyway,
   * because a section that will not open is worse than a flat background.
   */
  function mount(host, variant, opts) {
    if (!host) return { destroy: function () {} };
    opts = opts || {};
    var tint = opts.tint || [0.83, 0.69, 0.22];
    var seed = typeof opts.seed === 'number' ? opts.seed : 0;
    if (!SHADERS[variant] && variant !== 'voxel' && variant !== 'paths' && variant !== 'wave') {
      variant = 'crystal';
    }

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

    // Three of the six are not fullscreen-quad shaders and mount differently.
    if (variant === 'voxel') return mountVoxel(layer, tint, seed);
    if (variant === 'paths') return mountPaths(layer, tint, seed);
    if (variant === 'wave')  return mountWave(layer, tint, seed);

    /* Full strength.
       The first version of this shipped the canvas at 42% opacity under a
       72-86% dark scrim, which left about nine percent of the shader on
       screen — on an already dark page that is indistinguishable from no
       backdrop at all, and it was reported as "you did not change the
       background". Readability is protected where it should be, by the
       content's own panels, not by erasing the thing behind them. */
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block; width:100%; height:100%; ' +
      'filter:saturate(1.08) contrast(1.04);';
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
    var uTint  = gl.getUniformLocation(prog, 'u_tint');
    var uSeed  = gl.getUniformLocation(prog, 'u_seed');

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
      if (uTint) gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
      if (uSeed) gl.uniform1f(uSeed, seed);
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

  function show(host, variant, opts) {
    if (current) { current.destroy(); current = null; }
    current = mount(host, variant, opts);
    return current;
  }

  /** Mount the background that belongs to a given portal, by its key. */
  function showFor(host, key, index) {
    var theme = themeFor(key, index);
    return show(host, theme.engine, { tint: theme.tint, seed: theme.seed });
  }

  function clear() {
    if (current) { current.destroy(); current = null; }
  }

  /* ── one background per portal ─────────────────────────────────────────
     Sixteen portals, sixteen looks. Four engines, each in four colourways
     with its own seed, so no two portals share a background and each one is
     recognisable on sight — Attendance is always the teal city, Certificates
     always the violet scan.

     Colours are not decorative-random: they follow what the section is for.
     Money is green, documents and certificates are gold and violet, tests and
     coding are cool blues, the social ones are warm. */
  var THEMES = {
    /* Reading-heavy sections get the two cheapest engines — paths costs no
       render loop at all, and the fullscreen shaders are a single quad. The
       two expensive ones, voxel and wave, go to the short, glanceable
       screens where nobody sits for ten minutes. */
    'stu-view-overview':          { engine: 'wave',    tint: [0.55, 0.78, 1.00], seed: 0.00 },
    'stu-view-notice':            { engine: 'beam',    tint: [1.00, 0.62, 0.28], seed: 0.13 },
    'stu-view-coordinator-tasks': { engine: 'paths',   tint: [0.42, 0.85, 0.95], seed: 0.27 },
    'stu-view-domain-tasks':      { engine: 'crystal', tint: [0.42, 0.62, 1.00], seed: 0.41 },
    'stu-view-submissions':       { engine: 'paths',   tint: [0.58, 1.00, 0.72], seed: 0.55 },
    'stu-view-attendance':        { engine: 'beam',    tint: [0.35, 0.95, 0.85], seed: 0.68 },
    'stu-view-test':              { engine: 'scan',    tint: [0.68, 0.60, 1.00], seed: 0.81 },
    'stu-view-coding':            { engine: 'voxel',   tint: [0.30, 0.85, 0.95], seed: 0.94 },
    'stu-view-guidelines':        { engine: 'paths',   tint: [0.95, 0.85, 0.50], seed: 0.07 },
    'stu-view-leaderboard':       { engine: 'voxel',   tint: [1.00, 0.80, 0.25], seed: 0.21 },
    'v2-tasks':                   { engine: 'scan',    tint: [1.00, 0.72, 0.30], seed: 0.34 },
    'my-documents':               { engine: 'paths',   tint: [0.95, 0.70, 0.35], seed: 0.47 },
    'my-certificates':            { engine: 'crystal', tint: [0.78, 0.60, 1.00], seed: 0.61 },
    'payment':                    { engine: 'beam',    tint: [0.40, 1.00, 0.62], seed: 0.74 },
    'assistant':                  { engine: 'wave',    tint: [1.00, 0.84, 0.36], seed: 0.88 },
    'ten-network':                { engine: 'voxel',   tint: [0.62, 0.55, 1.00], seed: 0.02 },
    /* The landing page's portals ring gets its own, distinct from all of them. */
    'landing-portals':            { engine: 'scan',    tint: [0.92, 0.78, 0.32], seed: 0.50 }
  };

  var ORDER = ['crystal', 'beam', 'scan', 'voxel', 'paths', 'wave'];

  /**
   * The theme for a portal. Accepts the section id (or page key) it belongs
   * to; falls back to rotating the four engines for anything unrecognised, so
   * a new section still gets a background rather than nothing.
   */
  function themeFor(key, index) {
    if (THEMES[key]) return THEMES[key];
    var i = Number(index);
    if (!isFinite(i) || i < 0) i = 0;
    return { engine: ORDER[i % ORDER.length], tint: [0.83, 0.69, 0.22], seed: (i % 16) / 16 };
  }

  /** Kept for callers that only want an engine name. */
  function variantFor(index) {
    var i = Number(index);
    if (!isFinite(i) || i < 0) i = 0;
    return ORDER[i % ORDER.length];
  }

  global.PortalBackdrop = {
    mount: mount,
    show: show,
    showFor: showFor,
    clear: clear,
    themeFor: themeFor,
    variantFor: variantFor,
    themes: THEMES,
    variants: ORDER.slice()
  };
})(window);
