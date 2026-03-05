import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';

// Define the parameters we want to tweak
const params = {
    scale: 2.0,
    iterations: 12,
    baseColor: [0.8, 0.4, 0.1], // RGB array for the color picker
    lightX: 2.0,
    lightY: 3.0,
    lightZ: -2.0
};

// Initialize the UI panel
const gui = new GUI({ title: 'Fractal Controls' });

// Add sliders and folders
const mathFolder = gui.addFolder('Mathematics');
mathFolder.add(params, 'scale', -3.0, 3.0).name('Box Scale');
mathFolder.add(params, 'iterations', 1, 30, 1).name('Iterations');

const visualFolder = gui.addFolder('Visuals');
visualFolder.addColor(params, 'baseColor').name('Surface Color');
visualFolder.add(params, 'lightX', -10.0, 10.0).name('Light X');
visualFolder.add(params, 'lightY', -10.0, 10.0).name('Light Y');
visualFolder.add(params, 'lightZ', -10.0, 10.0).name('Light Z');

const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2');

if (!gl) {
    alert('WebGL2 is not supported by your browser.');
}

// Resize canvas to match display size
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// The Shaders (defined as strings for now, you can move these to separate files later)
const vsSource = `#version 300 es
    in vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fsSource = `#version 300 es
    precision highp float;
    
    out vec4 outColor;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec3 u_ro; 
    uniform vec3 u_ta; 

    // NEW UNIFORMS from our UI
    uniform float u_scale;
    uniform int u_iterations;
    uniform vec3 u_baseColor;
    uniform vec3 u_lightPos;

    float map(vec3 p) {
        vec3 offset = p;
        float dr = 1.0;
        
        // Loop runs based on the UI slider now
        for (int i = 0; i < u_iterations; i++) {
            p = clamp(p, -1.0, 1.0) * 2.0 - p;
            
            float r2 = dot(p, p);
            if (r2 < 0.25) { 
                p *= 4.0;
                dr *= 4.0;
            } else if (r2 < 1.0) { 
                p /= r2;
                dr /= r2;
            }
            
            // Scale uses the UI slider
            p = p * u_scale + offset;
            dr = dr * abs(u_scale) + 1.0;
        }
        
        return length(p) / abs(dr);
    }

    vec3 getNormal(vec3 p) {
        float d = map(p);
        vec2 e = vec2(0.001, 0.0);
        vec3 n = d - vec3(
            map(p - e.xyy),
            map(p - e.yxy),
            map(p - e.yyx)
        );
        return normalize(n);
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / u_resolution.y;

        vec3 ta = u_ta; 
        vec3 ww = normalize(ta - u_ro); 
        vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0))); 
        vec3 vv = normalize(cross(uu, ww)); 
        vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.0 * ww); 

        float t = 0.0;
        int max_steps = 100;
        float max_dist = 100.0;
        float surf_dist = 0.001;

        for(int i = 0; i < max_steps; i++) {
            vec3 p = u_ro + rd * t;
            float d = map(p);
            t += d;
            if(d < surf_dist || t > max_dist) break;
        }

        vec3 col = vec3(0.0); 

        if(t < max_dist) {
            vec3 p = u_ro + rd * t;       
            vec3 n = getNormal(p);      
            
            // Light position from UI
            vec3 lightDir = normalize(u_lightPos - p);
            
            float dif = clamp(dot(n, lightDir), 0.0, 1.0);
            float ambient = 0.1;
            
            // Base color from UI
            col = u_baseColor * (dif + ambient);
            
            float rim = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
            col += vec3(0.2, 0.1, 0.0) * pow(rim, 4.0);
        }

        col = pow(col, vec3(1.0/2.2)); 
        outColor = vec4(col, 1.0);
    }
`;

// Shader compilation helper
function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

// Build the shader program
const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

// Set up the full-screen quad (two triangles making a rectangle)
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = new Float32Array([
    -1.0, -1.0,   1.0, -1.0,  -1.0,  1.0,
    -1.0,  1.0,   1.0, -1.0,   1.0,  1.0
]);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

// Get uniform locations
const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
const timeLocation = gl.getUniformLocation(program, 'u_time');

// --- First-Person Camera Controls (Mouse & Touch) ---
let isLooking = false;
let isPanning = false;
let lastInput = { x: 0, y: 0 };
let lastTouchDistance = 0;
let lastTouchCenter = { x: 0, y: 0 };

// Target values (driven instantly by user input)
let tYaw = 0.0;
let tPitch = 0.0;
let tPos = { x: 0.0, y: 0.0, z: 4.0 }; // Start pulled back slightly

// Current values (eased toward target values every frame)
let cYaw = 0.0;
let cPitch = 0.0;
let cPos = { x: 0.0, y: 0.0, z: 4.0 };

canvas.addEventListener('contextmenu', e => e.preventDefault());

// --- MOUSE EVENTS ---
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) isLooking = true; // Left click: Turn head
    if (e.button === 2) isPanning = true; // Right click: Move body up/down/left/right
    lastInput = { x: e.offsetX, y: e.offsetY };
});

canvas.addEventListener('mousemove', (e) => {
    let deltaX = e.offsetX - lastInput.x;
    let deltaY = e.offsetY - lastInput.y;

    if (isLooking) {
        tYaw -= deltaX * 0.005; // Drag left/right to turn head
        tPitch -= deltaY * 0.005; // Drag up/down to look up/down
        tPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, tPitch));
    }

    if (isPanning) handlePan(deltaX, deltaY);

    lastInput = { x: e.offsetX, y: e.offsetY };
});

window.addEventListener('mouseup', () => { isLooking = false; isPanning = false; }); 

canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); 
    handleForwardMovement(-e.deltaY * 0.005); // Scroll to walk forward/backward
}, { passive: false });


// --- TOUCH EVENTS ---
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        isLooking = true;
        lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
        isLooking = false;
        isPanning = true;
        lastTouchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        lastTouchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isLooking) {
        let deltaX = e.touches[0].clientX - lastInput.x;
        let deltaY = e.touches[0].clientY - lastInput.y;
        
        tYaw -= deltaX * 0.005;
        tPitch -= deltaY * 0.005;
        tPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, tPitch));
        lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } 
    else if (e.touches.length === 2 && isPanning) {
        const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const currentCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        
        handleForwardMovement((currentDistance - lastTouchDistance) * 0.01); // Pinch to walk
        handlePan(currentCenter.x - lastTouchCenter.x, currentCenter.y - lastTouchCenter.y); // Two-finger drag to strafe
        
        lastTouchDistance = currentDistance;
        lastTouchCenter = currentCenter;
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (e.touches.length < 2) isPanning = false;
    if (e.touches.length === 0) isLooking = false;
    if (e.touches.length === 1) {
        lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        isLooking = true;
    }
});
canvas.addEventListener('touchcancel', () => { isLooking = false; isPanning = false; });


// --- MOVEMENT HELPERS ---
function handlePan(deltaX, deltaY) {
    // Calculate Right and Up vectors relative to where we are currently looking
    let rightX = Math.cos(tYaw);
    let rightZ = Math.sin(tYaw);
    let upX = -Math.sin(tYaw) * Math.sin(tPitch);
    let upY = Math.cos(tPitch);
    let upZ = Math.cos(tYaw) * Math.sin(tPitch);

    let panSpeed = 0.005;
    tPos.x -= rightX * deltaX * panSpeed - upX * deltaY * panSpeed;
    tPos.y -= -upY * deltaY * panSpeed;
    tPos.z -= rightZ * deltaX * panSpeed - upZ * deltaY * panSpeed;
}

function handleForwardMovement(amount) {
    // Calculate Forward vector
    let fwdX = Math.sin(tYaw) * Math.cos(tPitch);
    let fwdY = Math.sin(tPitch);
    let fwdZ = -Math.cos(tYaw) * Math.cos(tPitch);

    tPos.x += fwdX * amount;
    tPos.y += fwdY * amount;
    tPos.z += fwdZ * amount;
}

// Add this near your other location grabs
const roLocation = gl.getUniformLocation(program, 'u_ro');
const taLocation = gl.getUniformLocation(program, 'u_ta'); // NEW
const scaleLocation = gl.getUniformLocation(program, 'u_scale');
const iterationsLocation = gl.getUniformLocation(program, 'u_iterations');
const baseColorLocation = gl.getUniformLocation(program, 'u_baseColor');
const lightPosLocation = gl.getUniformLocation(program, 'u_lightPos');

// The Render Loop
function render(time) {
    time *= 0.001;

    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, time);

    // 1. Smoothly interpolate current values toward target values
    let lerpSpeed = 0.1;
    cYaw += (tYaw - cYaw) * lerpSpeed;
    cPitch += (tPitch - cPitch) * lerpSpeed;
    cPos.x += (tPos.x - cPos.x) * lerpSpeed;
    cPos.y += (tPos.y - cPos.y) * lerpSpeed;
    cPos.z += (tPos.z - cPos.z) * lerpSpeed;

    // 2. Calculate the "Look Target" by projecting a point in front of the camera
    let fwdX = Math.sin(cYaw) * Math.cos(cPitch);
    let fwdY = Math.sin(cPitch);
    let fwdZ = -Math.cos(cYaw) * Math.cos(cPitch);

    let targetX = cPos.x + fwdX;
    let targetY = cPos.y + fwdY;
    let targetZ = cPos.z + fwdZ;

    // 3. Send the position and projected target to the GPU
    gl.uniform3f(roLocation, cPos.x, cPos.y, cPos.z);
    gl.uniform3f(taLocation, targetX, targetY, targetZ);

    // Send the math params
    gl.uniform1f(scaleLocation, params.scale);
    gl.uniform1i(iterationsLocation, params.iterations);

    // Send the visual params
    gl.uniform3f(baseColorLocation, params.baseColor[0], params.baseColor[1], params.baseColor[2]);
    gl.uniform3f(lightPosLocation, params.lightX, params.lightY, params.lightZ);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}

requestAnimationFrame(render);
