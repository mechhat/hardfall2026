/**
 * Creates a BW threshold canvas from a video element and prepends it.
 * Returns a control object to update HSV range or stop processing.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {Object} [opts]
 * @param {number} opts.hMin - Hue min 0-360 (default 38)
 * @param {number} opts.hMax - Hue max 0-360 (default 72)
 * @param {number} opts.sMin - Saturation min 0-100 (default 40)
 * @param {number} opts.sMax - Saturation max 0-100 (default 100)
 * @param {number} opts.vMin - Brightness min 0-100 (default 45)
 * @param {number} opts.vMax - Brightness max 0-100 (default 100)
 * @returns {{ canvas: HTMLCanvasElement, setHSV(opts): void, destroy(): void }}
 */
function createHSVThreshold(videoEl, opts = {}) {
  const hsv = {
    hMin: opts.hMin ?? 38,  hMax: opts.hMax ?? 72,
    sMin: opts.sMin ?? 40,  sMax: opts.sMax ?? 100,
    vMin: opts.vMin ?? 45,  vMax: opts.vMax ?? 100,
  };

  const canvas = document.createElement("canvas");
  const computed = getComputedStyle(videoEl);
  for (const prop of computed) {
    try { canvas.style.setProperty(prop, computed.getPropertyValue(prop)); } catch {}
  }
  canvas.style.display = computed.display === "none" ? "block" : computed.display;
  videoEl.parentNode.insertBefore(canvas, videoEl);

  const gl = canvas.getContext("webgl", { antialias: false });
  if (!gl) throw new Error("WebGL not supported");

  // --- compile shaders ---
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      v_uv.y = 1.0 - v_uv.y;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }`);

  const fs = compile(gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_tex;
    uniform vec3 u_lo, u_hi;
    varying vec2 v_uv;

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    void main() {
      vec3 hsv = rgb2hsv(texture2D(u_tex, v_uv).rgb);
      bool hue = (u_lo.x <= u_hi.x)
        ? (hsv.x >= u_lo.x && hsv.x <= u_hi.x)
        : (hsv.x >= u_lo.x || hsv.x <= u_hi.x);
      bool hit = hue
        && hsv.y >= u_lo.y && hsv.y <= u_hi.y
        && hsv.z >= u_lo.z && hsv.z <= u_hi.z;
      gl_FragColor = vec4(vec3(hit ? 1.0 : 0.0), 1.0);
    }`);

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // --- fullscreen quad ---
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // --- texture ---
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uLo = gl.getUniformLocation(prog, "u_lo");
  const uHi = gl.getUniformLocation(prog, "u_hi");

  // --- render loop ---
  let raf = 0;
  let destroyed = false;

  function draw() {
    if (destroyed) return;
    const w = videoEl.videoWidth, h = videoEl.videoHeight;
    if (w && h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
      gl.uniform3f(uLo, hsv.hMin / 360, hsv.sMin / 100, hsv.vMin / 100);
      gl.uniform3f(uHi, hsv.hMax / 360, hsv.sMax / 100, hsv.vMax / 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Prefer requestVideoFrameCallback when available
    if ("requestVideoFrameCallback" in videoEl) {
      videoEl.requestVideoFrameCallback(draw);
    } else {
      raf = requestAnimationFrame(draw);
    }
  }

  // Start when video plays (or immediately if already playing)
  if (!videoEl.paused) {
    draw();
  }
  videoEl.addEventListener("play", draw);

  return {
    canvas,

    /** Update any subset of HSV thresholds on the fly */
    setHSV(newOpts) {
      for (const k of ["hMin","hMax","sMin","sMax","vMin","vMax"]) {
        if (newOpts[k] !== undefined) hsv[k] = newOpts[k];
      }
    },

    /** Remove the canvas and stop the render loop */
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      videoEl.removeEventListener("play", draw);
      canvas.remove();
      gl.deleteTexture(tex);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    },
  };
}