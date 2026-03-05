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
    baseColor: [0.8, 0.4, 0.1], 
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
    
    uniform vec3 u_camForward;
    uniform vec3 u_camRight;
    uniform vec3 u_camUp; 

    uniform float u_scale;
    uniform int u_iterations;
    uniform vec3 u_baseColor;
    uniform vec3 u_lightPos;

    float map(vec3 p) {
        vec3 offset = p;
        float dr = 1.0;
        
        for (int i = 0; i < 30; i++) {
            if (i >= u_iterations) break; 
            
            p = clamp(p, -1.0, 1.0) * 2.0 - p;
            
            float r2 = dot(p, p);
            if (r2 < 0.25) { 
                p *= 4.0;
                dr *= 4.0;
            } else if (r2 < 1.0) { 
                p /= r2;
                dr /= r2;
            }
            
            p = p * u_scale + offset;
            dr = dr * abs(u_scale) + 1.0;
        }
        return length(p) / abs(dr);
    }

    vec3 getNormal(vec3 p, float t) {
        // Epsilon scales with distance to reduce high-frequency normal noise
        float eps = max(0.0005, 0.001 * t); 
        vec2 e = vec2(eps, 0.0);
        
        vec3 n = map(p) - vec3(
            map(p - e.xyy),
            map(p - e.yxy),
            map(p - e.yyx)
        );
        return normalize(n);
    }

    // NEW: We moved the raymarching loop into its own function so we can call it multiple times
    vec3 getSceneColor(vec3 ro, vec3 rd) {
        float t = 0.0;
        int max_steps = 250; 
        float max_dist = 100.0;
        
        // Background color
        vec3 bgCol = vec3(0.02, 0.02, 0.03);
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
            float ambient = 0.15;
            
            col = u_baseColor * (dif + ambient);
            
            float rim = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
            vec3 rimColor = mix(u_baseColor, vec3(1.0), 0.6); 
            col += rimColor * pow(rim, 4.0) * 0.4;
        }

        col = mix(col, bgCol, 1.0 - exp(-0.03 * t));
        return col;
    }

    void main() {
        vec3 totalColor = vec3(0.0);
        
        // NEW: 2x2 Sub-pixel Anti-Aliasing Loop
        for(int m = 0; m < 2; m++) {
            for(int n = 0; n < 2; n++) {
                // Calculate sub-pixel offset
                vec2 offset = vec2(float(m), float(n)) / 2.0 - 0.25;
                
                // Apply offset to fragment coordinates
                vec2 uv = (gl_FragCoord.xy + offset * 2.0 - u_resolution.xy) / u_resolution.y;
                vec3 rd = normalize(uv.x * u_camRight + uv.y * u_camUp + 1.0 * u_camForward); 
                
                totalColor += getSceneColor(u_ro, rd);
            }
        }
        
        // Average the 4 samples
        totalColor /= 4.0;

        totalColor = pow(totalColor, vec3(1.0/2.2)); // Gamma correction
        outColor = vec4(totalColor, 1.0);
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
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0,   1.0, -1.0,  -1.0,  1.0,
    -1.0,  1.0,   1.0, -1.0,   1.0,  1.0
]), gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
const timeLocation = gl.getUniformLocation(program, 'u_time');
const roLocation = gl.getUniformLocation(program, 'u_ro');
const fwdLocation = gl.getUniformLocation(program, 'u_camForward');
const rightLocation = gl.getUniformLocation(program, 'u_camRight');
const upLocation = gl.getUniformLocation(program, 'u_camUp');
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
let isRolling = false;
let lastRollAngle = 0;
let lastInput = { x: 0, y: 0 };
let lastTouchDistance = 0;
let lastTouchCenter = { x: 0, y: 0 };

let tRot = { w: 1, x: 0, y: 0, z: 0 }; 
let tPos = { x: 0.0, y: 0.0, z: 4.0 }; 
let cRot = { w: 1, x: 0, y: 0, z: 0 }; 
let cPos = { x: 0.0, y: 0.0, z: 4.0 }; 

canvas.addEventListener('contextmenu', e => e.preventDefault());

// --- Mouse Events ---
canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        // Calculate the border thickness (18% of the smaller screen dimension)
        let borderSize = Math.min(canvas.width, canvas.height) * 0.18;
        
        // Check if the click is within that border on any of the 4 sides
        let isEdgeX = e.offsetX < borderSize || e.offsetX > canvas.width - borderSize;
        let isEdgeY = e.offsetY < borderSize || e.offsetY > canvas.height - borderSize;
        
        if (isEdgeX || isEdgeY) {
            isRolling = true;
            let cx = canvas.width / 2;
            let cy = canvas.height / 2;
            lastRollAngle = Math.atan2(e.offsetY - cy, e.offsetX - cx);
        } else {
            isLooking = true;
        }
    }
    if (e.button === 2) isPanning = true; 
    lastInput = { x: e.offsetX, y: e.offsetY };
});

canvas.addEventListener('mousemove', (e) => {
    let deltaX = e.offsetX - lastInput.x;
    let deltaY = e.offsetY - lastInput.y;

    if (isRolling) {
        let cx = canvas.width / 2;
        let cy = canvas.height / 2;
        let newAngle = Math.atan2(e.offsetY - cy, e.offsetX - cx);
        let dAngle = newAngle - lastRollAngle;
        
        // Handle 360 wrap-around
        if (dAngle > Math.PI) dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;

        let qRoll = Quat.fromAxisAngle([0, 0, 1], dAngle);
        tRot = Quat.normalize(Quat.multiply(tRot, qRoll)); 
        lastRollAngle = newAngle;
    } 
    else if (isLooking) {
        let qYaw = Quat.fromAxisAngle([0, 1, 0], -deltaX * 0.005);
        let qPitch = Quat.fromAxisAngle([1, 0, 0], -deltaY * 0.005);
        
        // Apply both Pitch AND Yaw locally for true 6DOF flight
        let qTurn = Quat.multiply(qYaw, qPitch);
        tRot = Quat.normalize(Quat.multiply(tRot, qTurn));
    }

    if (isPanning) handlePan(deltaX, deltaY);
    lastInput = { x: e.offsetX, y: e.offsetY };
});

window.addEventListener('mouseup', () => { isLooking = false; isPanning = false; isRolling = false; }); 
canvas.addEventListener('mouseleave', () => { isLooking = false; isPanning = false; isRolling = false; });

canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); 
    handleForwardMovement(-e.deltaY * 0.005); 
}, { passive: false });


// --- Touch Events ---
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        let tx = e.touches[0].clientX;
        let ty = e.touches[0].clientY;
        
        let borderSize = Math.min(canvas.width, canvas.height) * 0.18;
        
        let isEdgeX = tx < borderSize || tx > canvas.width - borderSize;
        let isEdgeY = ty < borderSize || ty > canvas.height - borderSize;
        
        if (isEdgeX || isEdgeY) {
            isRolling = true;
            let cx = canvas.width / 2;
            let cy = canvas.height / 2;
            lastRollAngle = Math.atan2(ty - cy, tx - cx);
        } else {
            isLooking = true;
        }
        lastInput = { x: tx, y: ty };
    } else if (e.touches.length === 2) {
        isLooking = false;
        isRolling = false;
        isPanning = true;
        lastTouchDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        lastTouchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        if (isRolling) {
            let cx = canvas.width / 2;
            let cy = canvas.height / 2;
            let newAngle = Math.atan2(e.touches[0].clientY - cy, e.touches[0].clientX - cx);
            let dAngle = newAngle - lastRollAngle;
            
            if (dAngle > Math.PI) dAngle -= Math.PI * 2;
            if (dAngle < -Math.PI) dAngle += Math.PI * 2;
            
            let qRoll = Quat.fromAxisAngle([0, 0, 1], dAngle);
            tRot = Quat.normalize(Quat.multiply(tRot, qRoll));
            lastRollAngle = newAngle;
        } 
        else if (isLooking) {
            let deltaX = e.touches[0].clientX - lastInput.x;
            let deltaY = e.touches[0].clientY - lastInput.y;
            
            let qYaw = Quat.fromAxisAngle([0, 1, 0], deltaX * 0.005);
            let qPitch = Quat.fromAxisAngle([1, 0, 0], deltaY * 0.005); // Touch inverted Y fix
            
            // Pure local rotation
            let qTurn = Quat.multiply(qYaw, qPitch);
            tRot = Quat.normalize(Quat.multiply(tRot, qTurn));
        }
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
    if (e.touches.length === 0) {
        isLooking = false;
        isRolling = false;
    }
    if (e.touches.length === 1) {
        lastInput = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        isLooking = true; 
    }
});
canvas.addEventListener('touchcancel', () => { isLooking = false; isPanning = false; isRolling = false; });


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

    gl.uniform1f(scaleLocation, params.scale);
    gl.uniform1i(iterationsLocation, params.iterations);
    gl.uniform3f(baseColorLocation, params.baseColor[0], params.baseColor[1], params.baseColor[2]);
    gl.uniform3f(lightPosLocation, params.lightX, params.lightY, params.lightZ);

    let lerpSpeed = 0.1;
    cPos.x += (tPos.x - cPos.x) * lerpSpeed;
    cPos.y += (tPos.y - cPos.y) * lerpSpeed;
    cPos.z += (tPos.z - cPos.z) * lerpSpeed;
    
    cRot = Quat.slerp(cRot, tRot, lerpSpeed);

    let fwd = Quat.rotateVec3(cRot, [0, 0, -1]);
    let right = Quat.rotateVec3(cRot, [1, 0, 0]);
    let up = Quat.rotateVec3(cRot, [0, 1, 0]);

    gl.uniform3f(roLocation, cPos.x, cPos.y, cPos.z);
    gl.uniform3f(fwdLocation, fwd.x, fwd.y, fwd.z);
    gl.uniform3f(rightLocation, right.x, right.y, right.z);
    gl.uniform3f(upLocation, up.x, up.y, up.z);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}

requestAnimationFrame(render);
