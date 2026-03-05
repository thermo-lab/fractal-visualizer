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

// --- UI Controls Setup ---
const params = {
    scale: 2.0,
    iterations: 12,
    baseColor: [0.8, 0.4, 0.1], // Copper-ish base
    lightX: 2.0,
    lightY: 3.0,
    lightZ: -2.0
};

const gui = new GUI({ title: 'Fractal Controls' });

const mathFolder = gui.addFolder('Mathematics');
mathFolder.add(params, 'scale', -3.0, 3.0).name('Box Scale');
mathFolder.add(params, 'iterations', 1, 30, 1).name('Iterations');

const visualFolder = gui.addFolder('Visuals');
visualFolder.addColor(params, 'baseColor').name('Surface Color');
visualFolder.add(params, 'lightX', -10.0, 10.0).name('Light X');
visualFolder.add(params, 'lightY', -10.0, 10.0).name('Light Y');
visualFolder.add(params, 'lightZ', -10.0, 10.0).name('Light Z');

// --- Shaders ---
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

    // Uniforms from the UI panel
    uniform float u_scale;
    uniform int u_iterations;
    uniform vec3 u_baseColor;
    uniform vec3 u_lightPos;

    // Mandelbox Distance Estimator
    float map(vec3 p) {
        vec3 offset = p;
        float dr = 1.0;
        
        // Hard loop limit set to 30 to satisfy WebGL compiler strictness
        for (int i = 0; i < 30; i++) {
            if (i >= u_iterations) break; 
            
            // Box Fold
            p = clamp(p, -1.0, 1.0) * 2.0 - p;
            
            // Sphere Fold
            float r2 = dot(p, p);
            if (r2 < 0.25) { 
                p *= 4.0;
                dr *= 4.0;
            } else if (r2 < 1.0) { 
                p /= r2;
                dr /= r2;
            }
            
            // Scale & Translate
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
        int max_steps = 150;
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
            
            vec3 lightDir = normalize(u_lightPos - p);
            
            float dif = clamp(dot(n, lightDir), 0.0, 1.0);
            float ambient = 0.1;
            
            col = u_baseColor * (dif + ambient);
            
            float rim = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
            col += vec3(0.2, 0.1, 0.0) * pow(rim, 4.0);
        }

        col = pow(col, vec3(1.0/2.2)); // Gamma Correction
        outColor = vec4(col, 1.0);
    }
`;

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

const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

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

// Fetch Uniform Locations
const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
const timeLocation = gl.getUniformLocation(program, 'u_time');
const roLocation = gl.getUniformLocation(program, 'u_ro');
const taLocation = gl.getUniformLocation(program, 'u_ta');
const scaleLocation = gl.getUniformLocation(program, 'u_scale');
const iterationsLocation = gl.getUniformLocation(program, 'u_iterations');
const baseColorLocation = gl.getUniformLocation(program, 'u_baseColor');
const lightPosLocation = gl.getUniformLocation(program, 'u_lightPos');


// --- Quaternion Math Helper ---
const Quat = {
    multiply: (a, b) => ({
        w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
        x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
        y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
        z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w
    }),
    fromAxisAngle: (axis, angle) => {
        const half = angle / 2;
        const s = Math.sin(half);
        return { w: Math.cos(half), x: axis[0]*s, y: axis[1]*s, z: axis[2]*s };
    },
    rotateVec3: (q, v) => {
        const ix = q.w * v[0] + q.y * v[2] - q.z * v[1];
        const iy = q.w * v[1] + q.z * v[0] - q.x * v[2];
        const iz = q.w * v[2] + q.x * v[1] - q.y * v[0];
        const iw = -q.x * v[0] - q.y * v[1] - q.z * v[2];
        return {
            x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
            y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
            z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
        };
    },
    normalize: (q) => {
        const len = Math.hypot(q.w, q.x, q.y, q.z);
        if (len === 0) return {w:1, x:0, y:0, z:0};
        return { w: q.w/len, x: q.x/len, y: q.y/len, z: q.z/len };
    },
    slerp: (a, b, t) => {
        let cosHalfTheta = a.w*b.w + a.x*b.x + a.y*b.y + a.z*b.z;
        let qm = b;
        if (cosHalfTheta < 0) {
            qm = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
            cosHalfTheta = -cosHalfTheta;
        }
        if (cosHalfTheta >= 1.0) return a;
        const halfTheta = Math.acos(cosHalfTheta);
        const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta*cosHalfTheta);
        if (Math.abs(sinHalfTheta) < 0.001) {
            return Quat.normalize({
                w: a.w*0.5 + qm.w*0.5, x: a.x*0.5 + qm.x*0.5,
                y: a.y*0.5 + qm.y*0.5, z: a.z*0.5 + qm.z*0.5
            });
        }
        const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
        const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
        return {
            w: a.w*ratioA + qm.w*ratioB, x: a.x*ratioA + qm.x*ratioB,
            y: a.y*ratioA + qm.y*ratioB, z: a.z*ratioA + qm.z*ratioB
        };
    }
};

// --- First-Person Camera State ---
let isLooking = false;
let isPanning = false;
let lastInput = { x: 0, y: 0 };
let lastTouchDistance = 0;
let lastTouchCenter = { x: 0, y: 0 };

let tRot = { w: 1, x: 0, y: 0, z: 0 }; // Target Rotation
let tPos = { x: 0.0, y: 0.0, z: 4.0 }; // Target Position

let cRot = { w: 1, x: 0, y: 0, z: 0 }; // Current Rotation
let cPos = { x: 0.0, y: 0.0, z: 4.0 }; // Current Position

canvas.addEventListener('contextmenu', e => e.preventDefault());

// --- Mouse Events ---
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) isLooking = true; 
    if (e.button === 2) isPanning = true; 
    lastInput = { x: e.offsetX, y: e.offsetY };
});

canvas.addEventListener('mousemove', (e) => {
    let deltaX = e.offsetX - lastInput.x;
    let deltaY = e.offsetY - lastInput.y;

    if (isLooking) {
        let qYaw = Quat.fromAxisAngle([0, 1, 0], -deltaX * 0.005);
        let qPitch = Quat.fromAxisAngle([1, 0, 0], -deltaY * 0.005);
        
        let qTurn = Quat.multiply(qYaw, qPitch);
        tRot = Quat.normalize(Quat.multiply(tRot, qTurn));
    }

    if (isPanning) handlePan(deltaX, deltaY);
    lastInput = { x: e.offsetX, y: e.offsetY };
});

window.addEventListener('mouseup', () => { isLooking = false; isPanning = false; }); 

canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); 
    handleForwardMovement(-e.deltaY * 0.005); 
}, { passive: false });


// --- Touch Events ---
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
        
        let qYaw = Quat.fromAxisAngle([0, 1, 0], -deltaX * 0.005);
        let qPitch = Quat.fromAxisAngle([1, 0, 0], deltaY * 0.005); // Inverted Y-axis fix 
        
        let qTurn = Quat.multiply(qYaw, qPitch);
        tRot = Quat.normalize(Quat.multiply(tRot, qTurn));
        
        lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } 
    else if (e.touches.length === 2 && isPanning) {
        const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const currentCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
        
        handleForwardMovement((currentDistance - lastTouchDistance) * 0.01); 
        handlePan(currentCenter.x - lastTouchCenter.x, currentCenter.y - lastTouchCenter.y); 
        
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
    tPos.x += fwd.x * amount;
    tPos.y += fwd.y * amount;
    tPos.z += fwd.z * amount;
}

// --- Render Loop ---
function render(time) {
    time *= 0.001; 

    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, time);

    // Feed UI Data to GPU
    gl.uniform1f(scaleLocation, params.scale);
    gl.uniform1i(iterationsLocation, params.iterations);
    gl.uniform3f(baseColorLocation, params.baseColor[0], params.baseColor[1], params.baseColor[2]);
    gl.uniform3f(lightPosLocation, params.lightX, params.lightY, params.lightZ);

    // Camera Interpolation (Easing)
    let lerpSpeed = 0.1;
    cPos.x += (tPos.x - cPos.x) * lerpSpeed;
    cPos.y += (tPos.y - cPos.y) * lerpSpeed;
    cPos.z += (tPos.z - cPos.z) * lerpSpeed;
    
    cRot = Quat.slerp(cRot, tRot, lerpSpeed);

    // Calculate Look Target
    let fwd = Quat.rotateVec3(cRot, [0, 0, -1]);
    let targetX = cPos.x + fwd.x;
    let targetY = cPos.y + fwd.y;
    let targetZ = cPos.z + fwd.z;

    gl.uniform3f(roLocation, cPos.x, cPos.y, cPos.z);
    gl.uniform3f(taLocation, targetX, targetY, targetZ);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}

requestAnimationFrame(render);
