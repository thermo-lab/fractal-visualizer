import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2');

if (!gl) {
    alert('WebGL2 is not supported by your browser.');
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- UI Parameters ---
const params = {
    scale: 2.0,
    iterations: 12,
    baseColor: [0.8, 0.4, 0.1], 
    bgColor: [0.02, 0.02, 0.03], 
    brightness: 1.2,
    lightX: 2.0,
    lightY: 3.0,
    lightZ: -2.0
};

// --- Camera State ---
let tRot = { w: 1, x: 0, y: 0, z: 0 }; 
let tPos = { x: 0.0, y: 0.0, z: 4.0 }; 
let cRot = { w: 1, x: 0, y: 0, z: 0 }; 
let cPos = { x: 0.0, y: 0.0, z: 4.0 }; 

// --- File I/O Logic ---
const generateUID = () => Math.random().toString(36).substring(2, 8);

const fileInput = document.createElement('input');
fileInput.type = 'file';
// Removing the 'accept' attribute entirely to prevent the OS from greying out the file.
// fileInput.accept = '.json'; 

// Push it off-screen instead of using display: none, which some browsers block clicks on.
fileInput.style.position = 'absolute';
fileInput.style.left = '-9999px';
document.body.appendChild(fileInput);

fileInput.onchange = e => {
    if (!e.target.files.length) return; 
    
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = readerEvent => {
        try {
            const state = JSON.parse(readerEvent.target.result);
            
            if (state.params) {
                Object.assign(params, state.params);
                gui.controllersRecursive().forEach(c => c.updateDisplay());
            }
            
            if (state.camera) {
                tPos = state.camera.pos;
                cPos = { x: tPos.x, y: tPos.y, z: tPos.z }; 
                
                tRot = state.camera.rot;
                cRot = { w: tRot.w, x: tRot.x, y: tRot.y, z: tRot.z }; 
            }
            
            console.log(`Loaded state ID: ${state.id}`);
        } catch (err) {
            console.error("Failed to parse JSON state file.", err);
            alert("Could not load file. Please ensure it is a valid fractal JSON state.");
        }
    }
    reader.readAsText(file);
    e.target.value = ''; 
};

const ioLogic = {
    saveState: () => {
        const uid = generateUID();
        const state = {
            id: uid, // Bake the ID into the file for later image matching
            params: params,
            camera: { pos: tPos, rot: tRot }
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `fractal_${uid}.json`);
        document.body.appendChild(downloadAnchorNode); 
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },
    loadState: () => {
        fileInput.click();
    }
};

// --- GUI Setup ---
const gui = new GUI({ title: 'Fractal Controls' });

const mathFolder = gui.addFolder('Mathematics');
mathFolder.add(params, 'scale', -3.0, 3.0).name('Box Scale');
mathFolder.add(params, 'iterations', 1, 30, 1).name('Iterations');

const visualFolder = gui.addFolder('Visuals');
visualFolder.addColor(params, 'baseColor').name('Surface Color');
visualFolder.addColor(params, 'bgColor').name('Background Color');
visualFolder.add(params, 'brightness', 0.1, 5.0, 0.1).name('Brightness');
visualFolder.add(params, 'lightX', -10.0, 10.0).name('Light X');
visualFolder.add(params, 'lightY', -10.0, 10.0).name('Light Y');
visualFolder.add(params, 'lightZ', -10.0, 10.0).name('Light Z');

const ioFolder = gui.addFolder('Import / Export');
ioFolder.add(ioLogic, 'saveState').name('Save State (JSON)');
ioFolder.add(ioLogic, 'loadState').name('Load State (JSON)');

// --- Global Dirty Flag for TAA ---
let isDirty = true;
let frameCount = 0;

// Tell the GUI to reset the accumulation if any slider is touched
gui.onChange(() => { isDirty = true; });

// --- 1. The Accumulation Shader (Renders Fractal & Blends History) ---
const vsAccum = `#version 300 es
    in vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fsAccum = `#version 300 es
    precision highp float;
    out vec4 outColor;
    
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_ro; 
    uniform vec3 u_camForward;
    uniform vec3 u_camRight;
    uniform vec3 u_camUp; 

    uniform float u_scale;
    uniform int u_iterations;
    uniform vec3 u_baseColor;
    uniform vec3 u_bgColor;
    uniform float u_brightness;
    uniform vec3 u_lightPos;

    // TAA Uniforms
    uniform sampler2D u_prevFrame;
    uniform float u_frame;
    uniform vec2 u_jitter;

    float map(vec3 p) {
        vec3 offset = p;
        float dr = 1.0;
        for (int i = 0; i < 30; i++) {
            if (i >= u_iterations) break; 
            p = clamp(p, -1.0, 1.0) * 2.0 - p;
            float r2 = dot(p, p);
            if (r2 < 0.25) { p *= 4.0; dr *= 4.0; } 
            else if (r2 < 1.0) { p /= r2; dr /= r2; }
            p = p * u_scale + offset;
            dr = dr * abs(u_scale) + 1.0;
        }
        return length(p) / abs(dr);
    }

    vec3 getNormal(vec3 p, float t) {
        float eps = max(0.0005, 0.001 * t); 
        vec2 e = vec2(eps, 0.0);
        vec3 n = map(p) - vec3(map(p - e.xyy), map(p - e.yxy), map(p - e.yyx));
        return normalize(n);
    }

    float calcAO(vec3 pos, vec3 nor) {
        float occ = 0.0; float sca = 1.0;
        for(int i = 0; i < 5; i++) {
            float h = 0.01 + 0.12 * float(i) / 4.0;
            float d = map(pos + h * nor);
            occ += (h - d) * sca; sca *= 0.95;
            if(occ > 0.35) break;
        }
        return clamp(1.0 - 3.0 * occ, 0.0, 1.0) * (0.5 + 0.5 * nor.y);
    }

    float calcShadow(vec3 ro, vec3 rd) {
        float res = 1.0; float t = 0.05; 
        for(int i = 0; i < 30; i++) {
            float h = map(ro + rd * t);
            res = min(res, 8.0 * h / t); 
            t += clamp(h, 0.02, 0.1);
            if(h < 0.001 || t > 10.0) break;
        }
        return clamp(res, 0.0, 1.0);
    }

    vec3 getSceneColor(vec3 ro, vec3 rd) {
        float t = 0.0;
        int max_steps = 250; 
        float max_dist = 100.0;
        vec3 bgCol = u_bgColor;
        vec3 col = bgCol;

        for(int i = 0; i < max_steps; i++) {
            vec3 p = ro + rd * t;
            float d = map(p);
            if(abs(d) < 0.001 * t || t > max_dist) break;
            t += d * 0.8; 
        }

        if(t < max_dist) {
            vec3 p = ro + rd * t;       
            vec3 n = getNormal(p, t);      
            vec3 lightDir = normalize(u_lightPos - p);
            
            float dif = clamp(dot(n, lightDir), 0.0, 1.0);
            float shadow = calcShadow(p, lightDir);
            float ao = calcAO(p, n);
            
            col = u_baseColor * (dif * shadow + 0.15 * ao);
            
            float rim = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
            vec3 rimColor = mix(u_baseColor, vec3(1.0), 0.6); 
            col += rimColor * pow(rim, 4.0) * 0.4 * ao; 
        }
        return mix(col, bgCol, 1.0 - exp(-0.03 * t));
    }

    void main() {
        // Apply sub-pixel jitter
        vec2 uv = (gl_FragCoord.xy + u_jitter - u_resolution.xy) / u_resolution.y;
        vec3 rd = normalize(uv.x * u_camRight + uv.y * u_camUp + 1.0 * u_camForward); 
        
        vec3 col = getSceneColor(u_ro, rd);
        col *= u_brightness; 

        // Blend linearly with previous frame
        vec2 screenUV = gl_FragCoord.xy / u_resolution.xy;
        vec3 prevCol = texture(u_prevFrame, screenUV).rgb;
        vec3 finalCol = mix(prevCol, col, 1.0 / (u_frame + 1.0));
        
        outColor = vec4(finalCol, 1.0);
    }
`;

// --- 2. The Screen Shader (Draws to Canvas & Applies Gamma) ---
const vsScreen = `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;
    void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fsScreen = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 outColor;
    uniform sampler2D u_texture;
    void main() {
        vec3 col = texture(u_texture, v_uv).rgb;
        col = pow(col, vec3(1.0/2.2)); // Gamma correction applied only at the very end
        outColor = vec4(col, 1.0);
    }
`;

function compileProgram(vs, fs) {
    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vs); gl.compileShader(vShader);
    const fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fs); gl.compileShader(fShader);
    const prog = gl.createProgram();
    gl.attachShader(prog, vShader); gl.attachShader(prog, fShader);
    gl.linkProgram(prog);
    return prog;
}

const accumProgram = compileProgram(vsAccum, fsAccum);
const screenProgram = compileProgram(vsScreen, fsScreen);

// --- 3. WebGL Framebuffer Setup ---
// Enable Float Textures for high-precision blending
if (!gl.getExtension('EXT_color_buffer_float')) {
    console.warn("Float textures not supported! Blending may have banding.");
}

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0,   1.0, -1.0,  -1.0,  1.0,
    -1.0,  1.0,   1.0, -1.0,   1.0,  1.0
]), gl.STATIC_DRAW);

// Helper to create a Float Texture
function createAccumTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, canvas.width, canvas.height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
}

let texA = createAccumTexture();
let texB = createAccumTexture();

let fboA = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texA, 0);

let fboB = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texB, 0);

// Fetch Accumulator Uniforms
const locRes = gl.getUniformLocation(accumProgram, 'u_resolution');
const locRo = gl.getUniformLocation(accumProgram, 'u_ro');
const locFwd = gl.getUniformLocation(accumProgram, 'u_camForward');
const locRight = gl.getUniformLocation(accumProgram, 'u_camRight');
const locUp = gl.getUniformLocation(accumProgram, 'u_camUp');
const locPrev = gl.getUniformLocation(accumProgram, 'u_prevFrame');
const locFrame = gl.getUniformLocation(accumProgram, 'u_frame');
const locJitter = gl.getUniformLocation(accumProgram, 'u_jitter');

const locScale = gl.getUniformLocation(accumProgram, 'u_scale');
const locIter = gl.getUniformLocation(accumProgram, 'u_iterations');
const locBase = gl.getUniformLocation(accumProgram, 'u_baseColor');
const locBg = gl.getUniformLocation(accumProgram, 'u_bgColor');
const locBright = gl.getUniformLocation(accumProgram, 'u_brightness');
const locLight = gl.getUniformLocation(accumProgram, 'u_lightPos');

// --- Movement Calculations ---
function handlePan(deltaX, deltaY) {
    let panSpeed = 0.005;
    let right = Quat.rotateVec3(tRot, [1, 0, 0]);
    let up = Quat.rotateVec3(tRot, [0, 1, 0]);
    tPos.x -= right.x * deltaX * panSpeed - up.x * deltaY * panSpeed;
    tPos.y -= right.y * deltaX * panSpeed - up.y * deltaY * panSpeed;
    tPos.z -= right.z * deltaX * panSpeed - up.z * deltaY * panSpeed;
}

function handleForwardMovement(amount) {
    let fwd = Quat.rotateVec3(tRot, [0, 0, -1]);
    tPos.x += fwd.x * amount; tPos.y += fwd.y * amount; tPos.z += fwd.z * amount;
}

// --- Render Loop ---
let texWidth = canvas.width;
let texHeight = canvas.height;

function render(time) {
    // 1. Detect if the screen resized to rebuild framebuffers
    if (canvas.width !== texWidth || canvas.height !== texHeight) {
        texWidth = canvas.width; texHeight = canvas.height;
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texWidth, texHeight, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindTexture(gl.TEXTURE_2D, texB);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, texWidth, texHeight, 0, gl.RGBA, gl.FLOAT, null);
        isDirty = true;
    }

    // 2. Camera Interpolation
    let lerpSpeed = 0.1;
    cPos.x += (tPos.x - cPos.x) * lerpSpeed;
    cPos.y += (tPos.y - cPos.y) * lerpSpeed;
    cPos.z += (tPos.z - cPos.z) * lerpSpeed;
    cRot = Quat.slerp(cRot, tRot, lerpSpeed);

    let fwd = Quat.rotateVec3(cRot, [0, 0, -1]);
    let right = Quat.rotateVec3(cRot, [1, 0, 0]);
    let up = Quat.rotateVec3(cRot, [0, 1, 0]);

    // 3. Detect movement to reset Accumulation
    let isMoving = Math.abs(tPos.x - cPos.x) > 0.0001 || Math.abs(tRot.x - cRot.x) > 0.0001;
    if (isMoving || isLooking || isPanning || isRolling || isDirty) {
        frameCount = 0;
        isDirty = false;
    }

    // --- PASS 1: Accumulate to FBO ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
    gl.useProgram(accumProgram);

    let posLoc = gl.getAttribLocation(accumProgram, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Set Data
    gl.uniform2f(locRes, canvas.width, canvas.height);
    gl.uniform3f(locRo, cPos.x, cPos.y, cPos.z);
    gl.uniform3f(locFwd, fwd.x, fwd.y, fwd.z);
    gl.uniform3f(locRight, right.x, right.y, right.z);
    gl.uniform3f(locUp, up.x, up.y, up.z);

    gl.uniform1f(locScale, params.scale);
    gl.uniform1i(locIter, params.iterations);
    gl.uniform3f(locBase, params.baseColor[0], params.baseColor[1], params.baseColor[2]);
    gl.uniform3f(locBg, params.bgColor[0], params.bgColor[1], params.bgColor[2]);
    gl.uniform1f(locBright, params.brightness);
    gl.uniform3f(locLight, params.lightX, params.lightY, params.lightZ);

    gl.uniform1f(locFrame, frameCount);
    
    // Sub-pixel jitter (0 on first frame, random offset afterwards)
    let jx = frameCount === 0 ? 0 : (Math.random() - 0.5);
    let jy = frameCount === 0 ? 0 : (Math.random() - 0.5);
    gl.uniform2f(locJitter, jx, jy);

    // Bind Texture B (history) to read from
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(locPrev, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- PASS 2: Draw FBO to Screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(screenProgram);
    
    let screenPosLoc = gl.getAttribLocation(screenProgram, 'a_position');
    gl.enableVertexAttribArray(screenPosLoc);
    gl.vertexAttribPointer(screenPosLoc, 2, gl.FLOAT, false, 0, 0);

    // Bind Texture A (the newly rendered frame) to draw
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.uniform1i(gl.getUniformLocation(screenProgram, 'u_texture'), 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- 4. Swap Ping-Pong Buffers ---
    let tempTex = texA; texA = texB; texB = tempTex;
    let tempFbo = fboA; fboA = fboB; fboB = tempFbo;

    frameCount++;
    requestAnimationFrame(render);
}

requestAnimationFrame(render);