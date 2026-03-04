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

// A starter Fragment Shader with a basic Raymarching loop
const fsSource = `#version 300 es
    precision highp float;
    
    out vec4 outColor;
    uniform vec2 u_resolution;
    uniform float u_time;

    // Signed Distance Function (SDF) - Currently a simple sphere
    float map(vec3 p) {
        return length(p) - 1.0; // Sphere with radius 1.0
    }

    void main() {
        // Normalize pixel coordinates (from -1 to 1) and fix aspect ratio
        vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / u_resolution.y;

        // Camera setup
        vec3 ro = vec3(0.0, 0.0, -3.0); // Ray Origin (Camera position)
        vec3 rd = normalize(vec3(uv, 1.0)); // Ray Direction

        // Raymarching loop
        float t = 0.0; // Total distance travelled
        int max_steps = 100;
        float max_dist = 100.0;
        float surf_dist = 0.001;
        
        float d = 0.0; // Distance to scene

        for(int i = 0; i < max_steps; i++) {
            vec3 p = ro + rd * t; // Current point along the ray
            d = map(p); // Distance to closest object
            t += d;     // Move the ray forward
            
            // Break if we hit the surface or go too far
            if(d < surf_dist || t > max_dist) break;
        }

        // Coloring
        vec3 col = vec3(0.0); // Background color (black)
        
        if(t < max_dist) {
            // We hit something! Let's just color it based on distance for now.
            col = vec3(1.0 - (t * 0.2)); 
            
            // Add a slow pulse using u_time
            col.r += sin(u_time) * 0.2; 
        }

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

// The Render Loop
function render(time) {
    time *= 0.001; // Convert to seconds

    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, time);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}

requestAnimationFrame(render);