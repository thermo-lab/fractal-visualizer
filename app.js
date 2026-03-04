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
    uniform vec3 u_ro; // NEW: Camera position from JavaScript
    uniform vec3 u_ta;

    // Mandelbox Distance Estimator
    float map(vec3 p) {
        vec3 offset = p;
        float dr = 1.0;
        
        // The core parameter of the Mandelbox. 
        // Try changing this to -1.5, 2.5, or 3.0 later for wildly different shapes!
        float scale = 2.0; 

        // The fractal iteration loop
        for (int i = 0; i < 12; i++) {
            
            // 1. Box Fold: mirrors space outside the limits (-1.0 to 1.0)
            p = clamp(p, -1.0, 1.0) * 2.0 - p;
            
            // 2. Sphere Fold: pushes space outward from the center
            float r2 = dot(p, p);
            if (r2 < 0.25) { 
                p *= 4.0;
                dr *= 4.0;
            } else if (r2 < 1.0) { 
                p /= r2;
                dr /= r2;
            }
            
            // 3. Scale and Translate
            p = p * scale + offset;
            dr = dr * abs(scale) + 1.0;
        }
        
        // Return estimated distance
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

        // NEW: Calculate a "LookAt" matrix to point the camera at the center
        vec3 ta = u_ta; // Target (Center of the fractal)
        vec3 ww = normalize(ta - u_ro); // Forward vector
        vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0))); // Right vector
        vec3 vv = normalize(cross(uu, ww)); // Up vector
        
        // Construct the final ray direction
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
            
            vec3 lightPos = vec3(2.0, 3.0, -2.0);
            vec3 lightDir = normalize(lightPos - p);
            
            float dif = clamp(dot(n, lightDir), 0.0, 1.0);
            float ambient = 0.1;
            
            vec3 baseColor = vec3(0.8, 0.4, 0.1); 
            col = baseColor * (dif + ambient);
            
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

// Add this near your other location grabs
const roLocation = gl.getUniformLocation(program, 'u_ro');
const taLocation = gl.getUniformLocation(program, 'u_ta'); // NEW

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

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}

requestAnimationFrame(render);