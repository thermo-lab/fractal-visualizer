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

// --- Smooth Camera Controls ---
let isOrbiting = false;
let isPanning = false;
let lastMouse = { x: 0, y: 0 };

// Target values (driven instantly by mouse input)
let tAngleX = 0.0;
let tAngleY = 0.0;
let tZoom = 2.5;
let tTarget = { x: 0.0, y: 0.0, z: 0.0 };

// Current values (eased toward target values every frame)
let cAngleX = 0.0;
let cAngleY = 0.0;
let cZoom = 2.5;
let cTarget = { x: 0.0, y: 0.0, z: 0.0 };

// Prevent the browser right-click menu from appearing
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) isOrbiting = true;
    if (e.button === 2) isPanning = true; // Right-click to pan
    lastMouse = { x: e.offsetX, y: e.offsetY };
});

canvas.addEventListener('mousemove', (e) => {
    let deltaX = e.offsetX - lastMouse.x;
    let deltaY = e.offsetY - lastMouse.y;

    if (isOrbiting) {
        tAngleX -= deltaX * 0.01;
        tAngleY += deltaY * 0.01;
        tAngleY = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, tAngleY));
    }

    if (isPanning) {
        // Calculate the camera's local X and Z heading so panning feels intuitive
        // regardless of which way you have orbited.
        let rightX = Math.cos(cAngleX);
        let rightZ = -Math.sin(cAngleX);

        let panSpeed = 0.002 * cZoom; // Pan speed scales based on how far zoomed out you are
        tTarget.x -= rightX * deltaX * panSpeed;
        tTarget.z -= rightZ * deltaX * panSpeed;
        tTarget.y += deltaY * panSpeed;
    }

    lastMouse = { x: e.offsetX, y: e.offsetY };
});

// Bind mouseup to window so we don't get stuck dragging if the cursor leaves the canvas
window.addEventListener('mouseup', () => { isOrbiting = false; isPanning = false; });

// Update the wheel event to use a smaller multiplier (0.0005 instead of 0.002)
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    tZoom += e.deltaY * 0.0005 * tZoom;
    tZoom = Math.max(0.1, Math.min(20.0, tZoom));
}, { passive: false });

// --- Touch Controls ---
let lastTouch = { x: 0, y: 0 };
let lastTouchDistance = 0;
let lastTouchCenter = { x: 0, y: 0 };

// Helper function to calculate distance between two fingers (for zooming)
function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

// Helper function to calculate the center point between two fingers (for panning)
function getTouchCenter(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
}

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevents the whole browser page from pulling/scrolling

    if (e.touches.length === 1) {
        isOrbiting = true;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
        isOrbiting = false;
        isPanning = true;
        lastTouchDistance = getTouchDistance(e.touches);
        lastTouchCenter = getTouchCenter(e.touches);
    }
}, { passive: false }); // passive: false is required to allow e.preventDefault()

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();

    // 1-Finger Orbit
    if (e.touches.length === 1 && isOrbiting) {
        let deltaX = e.touches[0].clientX - lastTouch.x;
        let deltaY = e.touches[0].clientY - lastTouch.y;

        tAngleX -= deltaX * 0.01;
        tAngleY += deltaY * 0.01;
        tAngleY = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, tAngleY));

        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    // 2-Finger Pan and Zoom
    else if (e.touches.length === 2 && isPanning) {
        // Handle Zoom (Pinch)
        const currentDistance = getTouchDistance(e.touches);
        const zoomDelta = lastTouchDistance - currentDistance;

        // Touch zooming needs a slightly higher multiplier than the mouse wheel
        tZoom += zoomDelta * 0.005 * tZoom;
        tZoom = Math.max(0.1, Math.min(20.0, tZoom));
        lastTouchDistance = currentDistance;

        // Handle Pan (Two-finger drag)
        const currentCenter = getTouchCenter(e.touches);
        const deltaX = currentCenter.x - lastTouchCenter.x;
        const deltaY = currentCenter.y - lastTouchCenter.y;

        let rightX = Math.cos(cAngleX);
        let rightZ = -Math.sin(cAngleX);

        let panSpeed = 0.002 * cZoom;
        tTarget.x -= rightX * deltaX * panSpeed;
        tTarget.z -= rightZ * deltaX * panSpeed;
        tTarget.y += deltaY * panSpeed;

        lastTouchCenter = currentCenter;
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();

    if (e.touches.length < 2) isPanning = false;
    if (e.touches.length === 0) isOrbiting = false;

    // If you lift one finger but keep the other down, seamlessly switch back to orbiting
    if (e.touches.length === 1) {
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        isOrbiting = true;
    }
});

// Failsafe in case a system notification interrupts the touch
canvas.addEventListener('touchcancel', () => {
    isOrbiting = false;
    isPanning = false;
});

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

    // 1. Lerp all camera parameters for buttery smoothness
    let lerpSpeed = 0.1;       // Fast response for panning/orbiting
    let zoomLerpSpeed = 0.04;  // Slower, silky response for zooming

    cAngleX += (tAngleX - cAngleX) * lerpSpeed;
    cAngleY += (tAngleY - cAngleY) * lerpSpeed;
    cZoom += (tZoom - cZoom) * zoomLerpSpeed; // Use the new smooth speed here
    cTarget.x += (tTarget.x - cTarget.x) * lerpSpeed;
    cTarget.y += (tTarget.y - cTarget.y) * lerpSpeed;
    cTarget.z += (tTarget.z - cTarget.z) * lerpSpeed;

    // 2. Calculate the camera position relative to our movable target
    let roX = cTarget.x + cZoom * Math.cos(cAngleY) * Math.sin(cAngleX);
    let roY = cTarget.y + cZoom * Math.sin(cAngleY);
    let roZ = cTarget.z + cZoom * Math.cos(cAngleY) * Math.cos(cAngleX);

    // 3. Send the updated position and target to the GPU
    gl.uniform3f(roLocation, roX, roY, roZ);
    gl.uniform3f(taLocation, cTarget.x, cTarget.y, cTarget.z);

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