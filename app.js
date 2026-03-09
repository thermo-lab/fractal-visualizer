import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });

if (!gl) alert('WebGL2 is not supported by your browser.');

// --- State Variables ---
let isDirty = true;
let frameCount = 0;
let isExporting = false;

let tRot = { w: 1, x: 0, y: 0, z: 0 };
let tPos = { x: 0.0, y: 0.0, z: 4.0 };
let cRot = { w: 1, x: 0, y: 0, z: 0 };
let cPos = { x: 0.0, y: 0.0, z: 4.0 };

let isLooking = false, isPanning = false, isRolling = false;
let lastRollAngle = 0, lastInput = { x: 0, y: 0 };
let lastTouchDistance = 0, lastTouchCenter = { x: 0, y: 0 };

// --- Inject UI Elements Automatically ---
let cropGuide = document.getElementById('crop-guide');
if (!cropGuide) {
    cropGuide = document.createElement('div');
    cropGuide.id = 'crop-guide';
    cropGuide.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); border: 2px dashed rgba(255, 255, 255, 0.7); box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6); pointer-events: none; z-index: 10; display: none;';
    document.body.appendChild(cropGuide);
}

const exportOverlay = document.createElement('div');
exportOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 9999; display: none; flex-direction: column; justify-content: center; align-items: center; color: white; font-family: monospace; text-align: center;';
const exportTitle = document.createElement('h1');
exportTitle.innerText = 'RENDERING HIGH-RES EXPORT';
const exportStatus = document.createElement('div');
exportStatus.style.cssText = 'margin: 20px 0; font-size: 1.2rem;';
const exportBarBg = document.createElement('div');
exportBarBg.style.cssText = 'width: 60%; max-width: 600px; height: 24px; border: 2px solid white; border-radius: 12px; overflow: hidden;';
const exportBarFill = document.createElement('div');
exportBarFill.style.cssText = 'width: 0%; height: 100%; background: white; transition: width 0.1s;';
exportBarBg.appendChild(exportBarFill);
exportOverlay.appendChild(exportTitle);
exportOverlay.appendChild(exportStatus);
exportOverlay.appendChild(exportBarBg);
document.body.appendChild(exportOverlay);

// --- UI Parameters ---
const params = {
    moveSpeed: 1.0,
    surfaceDetail: 0.001,

    fractalType: 0,
    scale: 2.0,
    iterations: 12,

    palA: [0.5, 0.5, 0.5],
    palB: [0.5, 0.5, 0.5],
    palC: [1.0, 1.0, 1.0],
    palD: [0.00, 0.33, 0.67],
    colorBlend: 1.5,

    bgColor: [0.02, 0.02, 0.03],
    brightness: 1.2,
    lightX: 2.0,
    lightY: 3.0,
    lightZ: -2.0,

    ambientLight: 0.15,
    rimStrength: 0.4,
    rimWhiteness: 0.6,
    fogDensity: 0.03,

    previewSamples: 60,
    showCrop: false,
    exportWidth: 2000,
    exportHeight: 3000,
    exportSamples: 60
};

function updateCropGuide() {
    if (!params.showCrop) {
        cropGuide.style.display = 'none';
        return;
    }
    cropGuide.style.display = 'block';

    const targetAspect = params.exportWidth / params.exportHeight;
    const windowAspect = window.innerWidth / window.innerHeight;

    let w, h;
    if (windowAspect > targetAspect) {
        h = window.innerHeight * 0.9;
        w = h * targetAspect;
    } else {
        w = window.innerWidth * 0.9;
        h = w / targetAspect;
    }

    cropGuide.style.width = `${w}px`;
    cropGuide.style.height = `${h}px`;
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    updateCropGuide();
    isDirty = true;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- File I/O & Export Logic ---
const generateUID = () => Math.random().toString(36).substring(2, 8);

const fileInput = document.createElement('input');
fileInput.type = 'file';
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
                for (let key in state.params) {
                    if (Array.isArray(params[key]) && Array.isArray(state.params[key])) {
                        for (let i = 0; i < params[key].length; i++) {
                            params[key][i] = state.params[key][i];
                        }
                    } else if (params[key] !== undefined) {
                        params[key] = state.params[key];
                    }
                }
                gui.controllersRecursive().forEach(c => c.updateDisplay());
                updateCropGuide();
            }
            if (state.camera) {
                tPos = state.camera.pos; cPos = { x: tPos.x, y: tPos.y, z: tPos.z };
                tRot = state.camera.rot; cRot = { w: tRot.w, x: tRot.x, y: tRot.y, z: tRot.z };
            }
            isDirty = true;
        } catch (err) { alert("Invalid state file."); }
    }
    reader.readAsText(file);
    e.target.value = '';
};

function createExportFBOs(w, h) {
    const createFloatTex = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    };

    const tA = createFloatTex(), tB = createFloatTex();
    const fA = gl.createFramebuffer(), fB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fA); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tA, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fB); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tB, 0);

    const tFinal = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tFinal);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fFinal = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fFinal); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tFinal, 0);

    return { tA, tB, fA, fB, tFinal, fFinal };
}

async function exportHighResImage() {
    if (isExporting) return;
    isExporting = true;
    params.showCrop = false;
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    updateCropGuide();

    const uid = generateUID();
    exportOverlay.style.display = 'flex';
    exportStatus.innerText = 'Initializing Memory...';
    exportBarFill.style.width = '0%';

    await new Promise(r => setTimeout(r, 100));

    const totalW = params.exportWidth;
    const totalH = params.exportHeight;
    //const tileSize = 1024;

// Change this line to dynamically choose smaller tiles for mobile screens
    const isMobile = window.innerWidth <= 768;
    const tileSize = isMobile ? 256 : 512; // Smaller bites for the GPU watchdog

    const cols = Math.ceil(totalW / tileSize);
    const rows = Math.ceil(totalH / tileSize);

    let exp = null;

    try {
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = totalW;
        finalCanvas.height = totalH;
        const ctx = finalCanvas.getContext('2d');

        gl.viewport(0, 0, tileSize, tileSize);
        exp = createExportFBOs(tileSize, tileSize);

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const curW = Math.min(tileSize, totalW - x * tileSize);
                const curH = Math.min(tileSize, totalH - y * tileSize);

                gl.bindFramebuffer(gl.FRAMEBUFFER, exp.fA); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
                gl.bindFramebuffer(gl.FRAMEBUFFER, exp.fB); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
                gl.bindFramebuffer(gl.FRAMEBUFFER, exp.fFinal); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

                let readTex = exp.tB;
                let writeFbo = exp.fA;

                // Track time to prevent watchdog crashes without over-yielding
                let lastYieldTime = performance.now();

                for (let s = 0; s < params.exportSamples; s++) {
                    drawExportFrame(totalW, totalH, x * tileSize, y * tileSize, s, writeFbo, readTex);
                    
                    let tempT = readTex; readTex = writeFbo === exp.fA ? exp.tA : exp.tB;
                    writeFbo = writeFbo === exp.fA ? exp.fB : exp.fA;

                    // SMART YIELD: Only pause if the loop has blocked the thread for more than 40ms.
                    // This lets the GPU process multiple samples instantly before taking a tiny breath.
                    if (performance.now() - lastYieldTime > 40) {
                        await new Promise(r => setTimeout(r, 0)); 
                        lastYieldTime = performance.now();
                    }
                }

                let finalFloatTex = writeFbo === exp.fA ? exp.tB : exp.tA;

                gl.bindFramebuffer(gl.FRAMEBUFFER, exp.fFinal);
                gl.useProgram(screenProgram);
                let screenPosLoc = gl.getAttribLocation(screenProgram, 'a_position');
                gl.enableVertexAttribArray(screenPosLoc);
                gl.vertexAttribPointer(screenPosLoc, 2, gl.FLOAT, false, 0, 0);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, finalFloatTex);
                gl.uniform1i(gl.getUniformLocation(screenProgram, 'u_texture'), 0);
                gl.drawArrays(gl.TRIANGLES, 0, 6);

                const pixels = new Uint8Array(curW * curH * 4);
                gl.readPixels(0, 0, curW, curH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                const imageData = ctx.createImageData(curW, curH);
                for (let i = 0; i < curH; i++) {
                    for (let j = 0; j < curW; j++) {
                        const srcIdx = ((curH - 1 - i) * curW + j) * 4;
                        const dstIdx = (i * curW + j) * 4;
                        imageData.data[dstIdx] = pixels[srcIdx];
                        imageData.data[dstIdx+1] = pixels[srcIdx+1];
                        imageData.data[dstIdx+2] = pixels[srcIdx+2];
                        imageData.data[dstIdx+3] = 255;
                    }
                }

                ctx.putImageData(imageData, x * tileSize, totalH - (y * tileSize) - curH);

                let progress = ((y * cols + x + 1) / (cols * rows)) * 100;
                exportStatus.innerText = `Processing Tile ${y * cols + x + 1} of ${cols * rows}`;
                exportBarFill.style.width = `${progress}%`;

                await new Promise(r => setTimeout(r, 10));
            }
        }

        exportStatus.innerText = 'Encoding PNG (This may take a minute)...';
        await new Promise(r => setTimeout(r, 100));

        finalCanvas.toBlob((blob) => {
            if(!blob) { alert("Image too large to encode to PNG! Try lowering the resolution."); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fractal_${uid}_${totalW}x${totalH}.png`;
            a.click();
            URL.revokeObjectURL(url);
        }, 'image/png');

    } catch (e) {
        alert("Export failed: " + e.message);
    } finally {
        if(exp) {
            gl.deleteTexture(exp.tA); gl.deleteTexture(exp.tB); gl.deleteTexture(exp.tFinal);
            gl.deleteFramebuffer(exp.fA); gl.deleteFramebuffer(exp.fB); gl.deleteFramebuffer(exp.fFinal);
        }
        isExporting = false;
        exportOverlay.style.display = 'none';
        gl.viewport(0, 0, canvas.width, canvas.height);
        isDirty = true;
    }
}

const ioLogic = {
    saveState: () => {
        const uid = generateUID();
        const state = { id: uid, params: params, camera: { pos: tPos, rot: tRot } };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const a = document.createElement('a');
        a.href = dataStr; a.download = `fractal_${uid}.json`;
        a.click();
    },
    loadState: () => fileInput.click(),
    exportImage: () => exportHighResImage()
};

// --- GUI Setup ---
const gui = new GUI({ title: 'Fractal Controls' });

gui.add(params, 'moveSpeed', 0.01, 1.0, 0.01).name('Movement Speed');

const mathFolder = gui.addFolder('Mathematics');
mathFolder.add(params, 'fractalType', { 'Mandelbox': 0, 'Sierpinski Pyramid': 1, 'Menger Sponge': 2 }).name('Fractal Type').onChange(() => { isDirty = true; });
mathFolder.add(params, 'scale', -3.0, 3.0).name('Box Scale');
mathFolder.add(params, 'iterations', 1, 30, 1).name('Iterations');

const palFolder = gui.addFolder('Algorithmic Palette');
palFolder.addColor(params, 'palA').name('Color Offset');
palFolder.addColor(params, 'palB').name('Color Contrast');
const freqFolder = palFolder.addFolder('Frequency (RGB)');
freqFolder.add(params.palC, 0, 0.0, 5.0, 0.01).name('Red Freq');
freqFolder.add(params.palC, 1, 0.0, 5.0, 0.01).name('Green Freq');
freqFolder.add(params.palC, 2, 0.0, 5.0, 0.01).name('Blue Freq');
const phaseFolder = palFolder.addFolder('Phase Shift (RGB)');
phaseFolder.add(params.palD, 0, 0.0, 1.0, 0.01).name('Red Phase');
phaseFolder.add(params.palD, 1, 0.0, 1.0, 0.01).name('Green Phase');
phaseFolder.add(params.palD, 2, 0.0, 1.0, 0.01).name('Blue Phase');
palFolder.add(params, 'colorBlend', 0.1, 10.0, 0.1).name('Wrap Tightness');

const visualFolder = gui.addFolder('Lighting & Environment');
visualFolder.add(params, 'surfaceDetail', 0.00001, 0.005, 0.00001).name('Surface Detail');
visualFolder.addColor(params, 'bgColor').name('Background / Fog');
visualFolder.add(params, 'brightness', 0.1, 5.0, 0.1).name('Brightness');

const matFolder = visualFolder.addFolder('Material Properties');
matFolder.add(params, 'ambientLight', 0.0, 1.0, 0.01).name('Ambient Light');
matFolder.add(params, 'rimStrength', 0.0, 2.0, 0.01).name('Rim Light Strength');
matFolder.add(params, 'rimWhiteness', 0.0, 1.0, 0.01).name('Rim Whiteness');
matFolder.add(params, 'fogDensity', 0.0, 0.1, 0.001).name('Fog Density');

visualFolder.add(params, 'lightX', -10.0, 10.0).name('Light X');
visualFolder.add(params, 'lightY', -10.0, 10.0).name('Light Y');
visualFolder.add(params, 'lightZ', -10.0, 10.0).name('Light Z');
visualFolder.add(params, 'previewSamples', 1, 200, 1).name('Preview Quality');

const exportFolder = gui.addFolder('High-Res Export');
exportFolder.add(params, 'showCrop').name('Show Crop Guide').onChange(updateCropGuide);
exportFolder.add(params, 'exportWidth', 1000, 16384, 1).name('Width (px)').onChange(updateCropGuide);
exportFolder.add(params, 'exportHeight', 1000, 16384, 1).name('Height (px)').onChange(updateCropGuide);
exportFolder.add(params, 'exportSamples', 10, 500, 1).name('Quality (TAA Samples)');
exportFolder.add(ioLogic, 'exportImage').name('RENDER IMAGE');

const ioFolder = gui.addFolder('Import / Export State');
ioFolder.add(ioLogic, 'saveState').name('Save State (JSON)');
ioFolder.add(ioLogic, 'loadState').name('Load State (JSON)');

gui.onChange(() => { isDirty = true; });

// --- Shaders ---
const vsAccum = `#version 300 es
    in vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const fsAccum = `#version 300 es
    precision highp float;
    out vec4 outColor;
    
    uniform vec2 u_targetResolution;
    uniform vec2 u_tileOffset;
    uniform float u_time;
    uniform vec3 u_ro; 
    uniform vec3 u_camForward;
    uniform vec3 u_camRight;
    uniform vec3 u_camUp; 

    uniform int u_fractalType;
    uniform float u_scale;
    uniform int u_iterations;
    
    uniform float u_surfaceDetail;
    uniform vec3 u_palA;
    uniform vec3 u_palB;
    uniform vec3 u_palC;
    uniform vec3 u_palD;
    uniform float u_colorBlend;

    uniform vec3 u_bgColor;
    uniform float u_brightness;
    uniform vec3 u_lightPos;
    
    uniform float u_ambientLight;
    uniform float u_rimStrength;
    uniform float u_rimWhiteness;
    uniform float u_fogDensity;

    uniform sampler2D u_prevFrame;
    uniform float u_frame;
    uniform vec2 u_jitter;

    vec2 map(vec3 p) {
        float dr = 1.0;
        float trap = 0.0;

        if (u_fractalType == 0) {
            vec3 offset = p;
            for (int i = 0; i < 30; i++) {
                if (i >= u_iterations) break; 
                vec3 prevP = p; 
                p = clamp(p, -1.0, 1.0) * 2.0 - p;
                float r2 = dot(p, p);
                if (r2 < 0.25) { p *= 4.0; dr *= 4.0; } 
                else if (r2 < 1.0) { p /= r2; dr /= r2; }
                p = p * u_scale + offset;
                dr = dr * abs(u_scale) + 1.0;
                trap += min(length(p - prevP), 10.0); 
            }
            return vec2(length(p) / abs(dr), trap / float(u_iterations));
        } else if (u_fractalType == 1) {
            for (int i = 0; i < 30; i++) {
                if (i >= u_iterations) break;
                vec3 prevP = p;
                if(p.x + p.y < 0.0) p.xy = -p.yx;
                if(p.x + p.z < 0.0) p.xz = -p.zx;
                if(p.y + p.z < 0.0) p.yz = -p.zy;
                p = p * u_scale - vec3(1.0) * (u_scale - 1.0);
                dr *= abs(u_scale);
                trap += min(length(p - prevP), 10.0);
            }
            return vec2((length(p) - 1.0) / abs(dr), trap / float(u_iterations));
        } else {
            for (int i = 0; i < 30; i++) {
                if (i >= u_iterations) break;
                vec3 prevP = p;
                p = abs(p);
                if (p.x < p.y) p.xy = p.yx;
                if (p.x < p.z) p.xz = p.zx;
                if (p.y < p.z) p.yz = p.zy;
                p = p * u_scale - vec3(1.0) * (u_scale - 1.0);
                if (p.z < -0.5 * (u_scale - 1.0)) p.z += u_scale - 1.0;
                dr *= abs(u_scale);
                trap += min(length(p - prevP), 10.0);
            }
            return vec2((length(p) - 1.0) / abs(dr), trap / float(u_iterations));
        }
    }

    vec3 getNormal(vec3 p, float t) {
        float eps = max(u_surfaceDetail * 0.1, u_surfaceDetail * t); 
        vec2 e = vec2(eps, 0.0);
        vec3 n = map(p).x - vec3(map(p - e.xyy).x, map(p - e.yxy).x, map(p - e.yyx).x);
        return normalize(n);
    }

    float calcAO(vec3 pos, vec3 nor) {
        float occ = 0.0; float sca = 1.0;
        for(int i = 0; i < 5; i++) {
            float h = 0.01 + 0.12 * float(i) / 4.0;
            float d = map(pos + h * nor).x;
            occ += (h - d) * sca; sca *= 0.95;
            if(occ > 0.35) break;
        }
        return clamp(1.0 - 3.0 * occ, 0.0, 1.0) * (0.5 + 0.5 * nor.y);
    }

    float calcShadow(vec3 ro, vec3 rd) {
        float res = 1.0; float t = 0.05; 
        for(int i = 0; i < 30; i++) {
            float h = map(ro + rd * t).x;
            res = min(res, 8.0 * h / t); 
            t += clamp(h, 0.02, 0.1);
            if(h < 0.001 || t > 10.0) break;
        }
        return clamp(res, 0.0, 1.0);
    }

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    vec3 getSceneColor(vec3 ro, vec3 rd) {
        float dither = random(gl_FragCoord.xy + u_frame * 13.0);
        float t = dither * 0.05; 
        
        int max_steps = 400; 
        float max_dist = 100.0;
        vec3 bgCol = u_bgColor;
        vec3 col = bgCol;
        
        bool hit = false; // NEW: Strict tracking of physical collision
        float d = 0.0;

        for(int i = 0; i < max_steps; i++) {
            vec3 p = ro + rd * t;
            d = map(p).x;
            
            // FIXED: Removed abs(). If d is negative, we stepped inside the wall. 
            // That is a confirmed physical hit. Break immediately!
            if(d < u_surfaceDetail * t) {
                hit = true;
                break;
            }
            if(t > max_dist) break;
            
            t += d * (u_fractalType == 0 ? 0.8 : 0.5); 
        }

        // FIXED: Only apply lighting if we definitively struck the surface.
        // This instantly deletes the floating, transparent "ghost" rays.
        if(hit) {
            vec3 p = ro + rd * t;       
            vec3 n = getNormal(p, t);      
            vec3 lightDir = normalize(u_lightPos - p);
            
            float trap = map(p).y;
            vec3 baseCol = u_palA + u_palB * cos(6.28318 * (u_palC * (trap * u_colorBlend) + u_palD));
            
            float dif = clamp(dot(n, lightDir), 0.0, 1.0);
            float shadow = calcShadow(p, lightDir);
            float ao = calcAO(p, n);
            
            col = baseCol * (dif * shadow + u_ambientLight * ao);
            
            float rim = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
            vec3 rimColor = mix(baseCol, vec3(1.0), u_rimWhiteness); 
            col += rimColor * pow(rim, 4.0) * u_rimStrength * ao; 
        }
        
        return mix(col, bgCol, 1.0 - exp(-u_fogDensity * t));
    }

    void main() {
        vec2 globalCoord = gl_FragCoord.xy + u_tileOffset;
        vec2 uv = ((globalCoord + u_jitter) * 2.0 - u_targetResolution.xy) / u_targetResolution.y;
        vec3 rd = normalize(uv.x * u_camRight + uv.y * u_camUp + 1.0 * u_camForward); 
        
        vec3 col = getSceneColor(u_ro, rd);
        col *= u_brightness; 

        vec2 viewportRes = vec2(textureSize(u_prevFrame, 0));
        vec2 screenUV = gl_FragCoord.xy / viewportRes;
        
        vec3 prevCol = texture(u_prevFrame, screenUV).rgb;
        vec3 finalCol = mix(prevCol, col, 1.0 / (u_frame + 1.0));
        
        outColor = vec4(finalCol, 1.0);
    }
`;

const vsScreen = `#version 300 es
    in vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fsScreen = `#version 300 es
    precision highp float;
    out vec4 outColor;
    uniform sampler2D u_texture;
    void main() {
        vec2 uv = gl_FragCoord.xy / vec2(textureSize(u_texture, 0));
        vec3 col = texture(u_texture, uv).rgb;
        
        col = max(col, 0.0);
        col = pow(col, vec3(1.0/2.2)); 
        
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - 0.5) / 255.0;

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

// --- WebGL Main Viewport FBO Setup ---
gl.getExtension('EXT_color_buffer_float');

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0,   1.0, -1.0,  -1.0,  1.0,
    -1.0,  1.0,   1.0, -1.0,   1.0,  1.0
]), gl.STATIC_DRAW);

let texA, texB, fboA, fboB;

function rebuildMainFBOs(w, h) {
    if(texA) gl.deleteTexture(texA);
    if(texB) gl.deleteTexture(texB);
    if(fboA) gl.deleteFramebuffer(fboA);
    if(fboB) gl.deleteFramebuffer(fboB);

    const createTex = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    };
    texA = createTex(); texB = createTex();
    fboA = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboA); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texA, 0);
    fboB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fboB); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texB, 0);
}
rebuildMainFBOs(canvas.width, canvas.height);

const locTargetRes = gl.getUniformLocation(accumProgram, 'u_targetResolution');
const locTileOffset = gl.getUniformLocation(accumProgram, 'u_tileOffset');
const locRo = gl.getUniformLocation(accumProgram, 'u_ro');
const locFwd = gl.getUniformLocation(accumProgram, 'u_camForward');
const locRight = gl.getUniformLocation(accumProgram, 'u_camRight');
const locUp = gl.getUniformLocation(accumProgram, 'u_camUp');
const locPrev = gl.getUniformLocation(accumProgram, 'u_prevFrame');
const locFrame = gl.getUniformLocation(accumProgram, 'u_frame');
const locJitter = gl.getUniformLocation(accumProgram, 'u_jitter');
const locFractalType = gl.getUniformLocation(accumProgram, 'u_fractalType');
const locScale = gl.getUniformLocation(accumProgram, 'u_scale');
const locIter = gl.getUniformLocation(accumProgram, 'u_iterations');

const locSurfaceDetail = gl.getUniformLocation(accumProgram, 'u_surfaceDetail');
const locPalA = gl.getUniformLocation(accumProgram, 'u_palA');
const locPalB = gl.getUniformLocation(accumProgram, 'u_palB');
const locPalC = gl.getUniformLocation(accumProgram, 'u_palC');
const locPalD = gl.getUniformLocation(accumProgram, 'u_palD');
const locColorBlend = gl.getUniformLocation(accumProgram, 'u_colorBlend');

const locBg = gl.getUniformLocation(accumProgram, 'u_bgColor');
const locBright = gl.getUniformLocation(accumProgram, 'u_brightness');
const locLight = gl.getUniformLocation(accumProgram, 'u_lightPos');

const locAmbientLight = gl.getUniformLocation(accumProgram, 'u_ambientLight');
const locRimStrength = gl.getUniformLocation(accumProgram, 'u_rimStrength');
const locRimWhiteness = gl.getUniformLocation(accumProgram, 'u_rimWhiteness');
const locFogDensity = gl.getUniformLocation(accumProgram, 'u_fogDensity');


// --- Quaternion Math ---
const Quat = {
    multiply: (a, b) => ({ w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z, x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y, y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x, z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w }),
    fromAxisAngle: (axis, angle) => { const half = angle / 2; const s = Math.sin(half); return { w: Math.cos(half), x: axis[0]*s, y: axis[1]*s, z: axis[2]*s }; },
    rotateVec3: (q, v) => {
        const ix = q.w * v[0] + q.y * v[2] - q.z * v[1]; const iy = q.w * v[1] + q.z * v[0] - q.x * v[2]; const iz = q.w * v[2] + q.x * v[1] - q.y * v[0]; const iw = -q.x * v[0] - q.y * v[1] - q.z * v[2];
        return { x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x };
    },
    normalize: (q) => { const len = Math.hypot(q.w, q.x, q.y, q.z); return len === 0 ? {w:1, x:0, y:0, z:0} : { w: q.w/len, x: q.x/len, y: q.y/len, z: q.z/len }; },
    slerp: (a, b, t) => {
        let cosHalfTheta = a.w*b.w + a.x*b.x + a.y*b.y + a.z*b.z; let qm = b;
        if (cosHalfTheta < 0) { qm = { w: -b.w, x: -b.x, y: -b.y, z: -b.z }; cosHalfTheta = -cosHalfTheta; }
        if (cosHalfTheta >= 1.0) return a;
        const halfTheta = Math.acos(cosHalfTheta); const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta*cosHalfTheta);
        if (Math.abs(sinHalfTheta) < 0.001) return Quat.normalize({ w: a.w*0.5 + qm.w*0.5, x: a.x*0.5 + qm.x*0.5, y: a.y*0.5 + qm.y*0.5, z: a.z*0.5 + qm.z*0.5 });
        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta; const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
        return { w: a.w*ratioA + qm.w*ratioB, x: a.x*ratioA + qm.x*ratioB, y: a.y*ratioA + qm.y*ratioB, z: a.z*ratioA + qm.z*ratioB };
    }
};

// --- Inputs ---
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        let borderSize = Math.min(canvas.width, canvas.height) * 0.18;
        let isEdgeX = e.clientX < borderSize || e.clientX > canvas.width - borderSize;
        let isEdgeY = e.clientY < borderSize || e.clientY > canvas.height - borderSize;
        if (isEdgeX || isEdgeY) { isRolling = true; lastRollAngle = Math.atan2(e.clientY - canvas.height / 2, e.clientX - canvas.width / 2); }
        else { isLooking = true; }
    }
    if (e.button === 2) isPanning = true;
    lastInput = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('mousemove', (e) => {
    let deltaX = e.clientX - lastInput.x; let deltaY = e.clientY - lastInput.y;
    let speedMult = Math.pow(params.moveSpeed, 2);
    if (e.shiftKey) speedMult *= 0.1;

    if (isRolling) {
        let newAngle = Math.atan2(e.clientY - canvas.height / 2, e.clientX - canvas.width / 2);
        let dAngle = newAngle - lastRollAngle;
        if (dAngle > Math.PI) dAngle -= Math.PI * 2; if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        tRot = Quat.normalize(Quat.multiply(tRot, Quat.fromAxisAngle([0, 0, 1], dAngle)));
        lastRollAngle = newAngle;
    } else if (isLooking) {
        let qTurn = Quat.multiply(
            Quat.fromAxisAngle([0, 1, 0], -deltaX * 0.005),
            Quat.fromAxisAngle([1, 0, 0], -deltaY * 0.005)
        );
        tRot = Quat.normalize(Quat.multiply(tRot, qTurn));
    }
    if (isPanning) handlePan(deltaX * speedMult, deltaY * speedMult);
    lastInput = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', () => { isLooking = false; isPanning = false; isRolling = false; });
canvas.addEventListener('mouseleave', () => { isLooking = false; isPanning = false; isRolling = false; });

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    let speedMult = Math.pow(params.moveSpeed, 2);
    if (e.shiftKey) speedMult *= 0.1;
    handleForwardMovement(-e.deltaY * 0.005 * speedMult);
}, { passive: false });

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        let tx = e.touches[0].clientX, ty = e.touches[0].clientY;
        let borderSize = Math.min(canvas.width, canvas.height) * 0.18;
        if (tx < borderSize || tx > canvas.width - borderSize || ty < borderSize || ty > canvas.height - borderSize) {
            isRolling = true; lastRollAngle = Math.atan2(ty - canvas.height / 2, tx - canvas.width / 2);
        } else { isLooking = true; }
        lastInput = { x: tx, y: ty };
    } else if (e.touches.length === 2) {
        isLooking = false; isRolling = false; isPanning = true;
        lastTouchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        lastTouchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    let speedMult = Math.pow(params.moveSpeed, 2);

    if (e.touches.length === 1) {
        if (isRolling) {
            let newAngle = Math.atan2(e.touches[0].clientY - canvas.height / 2, e.touches[0].clientX - canvas.width / 2);
            let dAngle = newAngle - lastRollAngle;
            if (dAngle > Math.PI) dAngle -= Math.PI * 2; if (dAngle < -Math.PI) dAngle += Math.PI * 2;
            tRot = Quat.normalize(Quat.multiply(tRot, Quat.fromAxisAngle([0, 0, 1], dAngle))); lastRollAngle = newAngle;
        } else if (isLooking) {
            let qTurn = Quat.multiply(
                Quat.fromAxisAngle([0, 1, 0], (e.touches[0].clientX - lastInput.x) * 0.005),
                Quat.fromAxisAngle([1, 0, 0], (e.touches[0].clientY - lastInput.y) * 0.005)
            );
            tRot = Quat.normalize(Quat.multiply(tRot, qTurn));
        }
        lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && isPanning) {
        const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const currentCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };

        handleForwardMovement((currentDistance - lastTouchDistance) * 0.01 * speedMult);
        handlePan((currentCenter.x - lastTouchCenter.x) * speedMult, (currentCenter.y - lastTouchCenter.y) * speedMult);

        lastTouchDistance = currentDistance; lastTouchCenter = currentCenter;
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (e.touches.length < 2) isPanning = false;
    if (e.touches.length === 0) { isLooking = false; isRolling = false; }
    if (e.touches.length === 1) { lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY }; isLooking = true; }
});
canvas.addEventListener('touchcancel', () => { isLooking = false; isPanning = false; isRolling = false; });

function handlePan(deltaX, deltaY) {
    let right = Quat.rotateVec3(tRot, [1, 0, 0]), up = Quat.rotateVec3(tRot, [0, 1, 0]);
    tPos.x -= right.x * deltaX * 0.005 - up.x * deltaY * 0.005; tPos.y -= right.y * deltaX * 0.005 - up.y * deltaY * 0.005; tPos.z -= right.z * deltaX * 0.005 - up.z * deltaY * 0.005;
}
function handleForwardMovement(amount) {
    let fwd = Quat.rotateVec3(tRot, [0, 0, -1]);
    tPos.x += fwd.x * amount; tPos.y += fwd.y * amount; tPos.z += fwd.z * amount;
}

// --- Dedicated Tile Renderer ---
const hash = (n) => { let f = Math.sin(n) * 43758.5453; return f - Math.floor(f); };

function drawExportFrame(targetWidth, targetHeight, offsetX, offsetY, frameIndex, fboWrite, texRead) {
    let fwd = Quat.rotateVec3(cRot, [0, 0, -1]);
    let right = Quat.rotateVec3(cRot, [1, 0, 0]);
    let up = Quat.rotateVec3(cRot, [0, 1, 0]);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboWrite);
    gl.useProgram(accumProgram);

    let posLoc = gl.getAttribLocation(accumProgram, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(locTargetRes, targetWidth, targetHeight);
    gl.uniform2f(locTileOffset, offsetX, offsetY);

    gl.uniform3f(locRo, cPos.x, cPos.y, cPos.z);
    gl.uniform3f(locFwd, fwd.x, fwd.y, fwd.z);
    gl.uniform3f(locRight, right.x, right.y, right.z);
    gl.uniform3f(locUp, up.x, up.y, up.z);

    gl.uniform1i(locFractalType, params.fractalType);
    gl.uniform1f(locScale, params.scale);
    gl.uniform1i(locIter, params.iterations);

    gl.uniform1f(locSurfaceDetail, params.surfaceDetail);
    gl.uniform3f(locPalA, params.palA[0], params.palA[1], params.palA[2]);
    gl.uniform3f(locPalB, params.palB[0], params.palB[1], params.palB[2]);
    gl.uniform3f(locPalC, params.palC[0], params.palC[1], params.palC[2]);
    gl.uniform3f(locPalD, params.palD[0], params.palD[1], params.palD[2]);
    gl.uniform1f(locColorBlend, params.colorBlend);

    gl.uniform3f(locBg, params.bgColor[0], params.bgColor[1], params.bgColor[2]);
    gl.uniform1f(locBright, params.brightness);
    gl.uniform3f(locLight, params.lightX, params.lightY, params.lightZ);

    gl.uniform1f(locAmbientLight, params.ambientLight);
    gl.uniform1f(locRimStrength, params.rimStrength);
    gl.uniform1f(locRimWhiteness, params.rimWhiteness);
    gl.uniform1f(locFogDensity, params.fogDensity);

    gl.uniform1f(locFrame, frameIndex);

    let jx = frameIndex === 0 ? 0 : hash(frameIndex * 12.9898) - 0.5;
    let jy = frameIndex === 0 ? 0 : hash(frameIndex * 78.2330) - 0.5;
    gl.uniform2f(locJitter, jx, jy);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texRead);
    gl.uniform1i(locPrev, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// --- Main Render Loop (Viewport Preview) ---
let texWidth = canvas.width, texHeight = canvas.height;

function render(time) {
    if (isExporting) {
        requestAnimationFrame(render);
        return;
    }

    if (canvas.width !== texWidth || canvas.height !== texHeight) {
        texWidth = canvas.width; texHeight = canvas.height;
        rebuildMainFBOs(texWidth, texHeight);
        isDirty = true;
    }

    // 1. Interpolate
    cPos.x += (tPos.x - cPos.x) * 0.1; 
    cPos.y += (tPos.y - cPos.y) * 0.1; 
    cPos.z += (tPos.z - cPos.z) * 0.1;
    cRot = Quat.slerp(cRot, tRot, 0.1);

    // 2. Snap Position (Using squared distance for cleaner math)
    let posDiffSq = (tPos.x - cPos.x)**2 + (tPos.y - cPos.y)**2 + (tPos.z - cPos.z)**2;
    if (posDiffSq < 0.0000000001) {
        cPos.x = tPos.x; cPos.y = tPos.y; cPos.z = tPos.z;
    }
    
    // 3. Snap Rotation (Using Dot Product to perfectly handle Quaternion sign-flipping)
    let dotRot = tRot.w*cRot.w + tRot.x*cRot.x + tRot.y*cRot.y + tRot.z*cRot.z;
    if (Math.abs(dotRot) > 0.999999) {
        cRot = { w: tRot.w, x: tRot.x, y: tRot.y, z: tRot.z };
    }

    // 4. Movement Detection
    let isMovingPos = tPos.x !== cPos.x || tPos.y !== cPos.y || tPos.z !== cPos.z;
    let isMovingRot = tRot.w !== cRot.w || tRot.x !== cRot.x || tRot.y !== cRot.y || tRot.z !== cRot.z;

    // FIXED: Removed input flags (isLooking, isPanning, isRolling) so TAA refines 
    // the exact millisecond the camera stops, even if you are still holding the input.
    if (isMovingPos || isMovingRot || isDirty) {
        frameCount = 0; 
        isDirty = false;
    }

    if (frameCount < params.previewSamples) {
        gl.viewport(0, 0, canvas.width, canvas.height);

        let jx = frameCount === 0 ? 0 : hash(frameCount * 12.9898) - 0.5;
        let jy = frameCount === 0 ? 0 : hash(frameCount * 78.2330) - 0.5;

        let fwd = Quat.rotateVec3(cRot, [0, 0, -1]);
        let right = Quat.rotateVec3(cRot, [1, 0, 0]);
        let up = Quat.rotateVec3(cRot, [0, 1, 0]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
        gl.useProgram(accumProgram);

        let posLoc = gl.getAttribLocation(accumProgram, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(locTargetRes, canvas.width, canvas.height);
        gl.uniform2f(locTileOffset, 0, 0);

        gl.uniform3f(locRo, cPos.x, cPos.y, cPos.z);
        gl.uniform3f(locFwd, fwd.x, fwd.y, fwd.z);
        gl.uniform3f(locRight, right.x, right.y, right.z);
        gl.uniform3f(locUp, up.x, up.y, up.z);

        gl.uniform1i(locFractalType, params.fractalType);
        gl.uniform1f(locScale, params.scale);
        gl.uniform1i(locIter, params.iterations);

        gl.uniform1f(locSurfaceDetail, params.surfaceDetail);
        gl.uniform3f(locPalA, params.palA[0], params.palA[1], params.palA[2]);
        gl.uniform3f(locPalB, params.palB[0], params.palB[1], params.palB[2]);
        gl.uniform3f(locPalC, params.palC[0], params.palC[1], params.palC[2]);
        gl.uniform3f(locPalD, params.palD[0], params.palD[1], params.palD[2]);
        gl.uniform1f(locColorBlend, params.colorBlend);

        gl.uniform3f(locBg, params.bgColor[0], params.bgColor[1], params.bgColor[2]);
        gl.uniform1f(locBright, params.brightness);
        gl.uniform3f(locLight, params.lightX, params.lightY, params.lightZ);

        gl.uniform1f(locAmbientLight, params.ambientLight);
        gl.uniform1f(locRimStrength, params.rimStrength);
        gl.uniform1f(locRimWhiteness, params.rimWhiteness);
        gl.uniform1f(locFogDensity, params.fogDensity);

        gl.uniform1f(locFrame, frameCount);
        gl.uniform2f(locJitter, jx, jy);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texB);
        gl.uniform1i(locPrev, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        let tempTex = texA; texA = texB; texB = tempTex;
        let tempFbo = fboA; fboA = fboB; fboB = tempFbo;

        frameCount++;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(screenProgram);
    let screenPosLoc = gl.getAttribLocation(screenProgram, 'a_position');
    gl.enableVertexAttribArray(screenPosLoc);
    gl.vertexAttribPointer(screenPosLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(gl.getUniformLocation(screenProgram, 'u_texture'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

requestAnimationFrame(render);