// ============================================
// Solar Tracker Dashboard - Real-Time Data from Blynk
// ============================================

// Blynk Configuration
const BLYNK_AUTH_TOKEN = 'CHDVXJCB7iVixAtAXsoaScjUG6KCl0ei';
const BLYNK_SERVER = 'https://blynk.cloud/external/api';

// Virtual Pin Mapping (must match sketch.ino):
// V1 = Voltage (float)
// V2 = Current (float)
// V3 = Power  (float)
// V4 = Pan Angle (int, 0-180)
// V5 = Tilt Angle (int, 0-180)

// DOM Elements
const elVoltage = document.getElementById('val-voltage');
const elCurrent = document.getElementById('val-current');
const elPower   = document.getElementById('val-power');
const elPan     = document.getElementById('val-pan');
const elTilt    = document.getElementById('val-tilt');
const elStatus  = document.getElementById('conn-status');
const elPanDir  = document.getElementById('val-pan-direction');
const elTiltDir = document.getElementById('val-tilt-direction');
const elEfficiency = document.getElementById('val-efficiency');
const elTimestamp  = document.getElementById('last-updated');

// History for sparkline charts
const HISTORY_SIZE = 30;
const voltageHistory = [];
const currentHistory = [];
const powerHistory   = [];

// 3D Scene
let scene, camera, renderer, solarPanel, pivot, sunLight, ground;
let sunSphere; // The visual "Sun"
let ldrValues = { tl: 0, tr: 0, bl: 0, br: 0 };
let ldrMeshes = {}; // Glowing LDR bulb meshes for visual tracking feedback
let currentPan = 90;
let currentTilt = 90;
let mouseX = 0, mouseY = 0;
let isMouseDown = false;
let cameraAngle = 0.5;
let cameraElevation = 0.3;
let cameraDistance = 30;

// ============================================
// Blynk Data Fetching - Fetch each pin individually for reliability
// ============================================
async function fetchSinglePin(pin) {
    try {
        const resp = await fetch(`${BLYNK_SERVER}/get?token=${BLYNK_AUTH_TOKEN}&${pin}`);
        if (!resp.ok) return null;
        const text = await resp.text();
        // Blynk returns raw JSON values, e.g. ["12.5"] or just 12.5
        try {
            const parsed = JSON.parse(text);
            // If array, take first element
            if (Array.isArray(parsed)) return parseFloat(parsed[0]);
            if (typeof parsed === 'object' && parsed !== null) {
                // Multi-pin response like {"v1": 7}
                const key = Object.keys(parsed).find(k => k.toLowerCase() === pin.toLowerCase());
                return key ? parseFloat(parsed[key]) : null;
            }
            return parseFloat(parsed);
        } catch {
            return parseFloat(text);
        }
    } catch {
        return null;
    }
}

async function fetchAllPins() {
    // Try batch first
    try {
        const resp = await fetch(`${BLYNK_SERVER}/get?token=${BLYNK_AUTH_TOKEN}&v1&v2&v3&v4&v5&v6&v7&v8&v9`);
        if (resp.ok) {
            const data = await resp.json();
            return {
                voltage:  parseFloat(data.v1 ?? data.V1 ?? NaN),
                current:  parseFloat(data.v2 ?? data.V2 ?? NaN),
                power:    parseFloat(data.v3 ?? data.V3 ?? NaN),
                panAngle: parseFloat(data.v4 ?? data.V4 ?? NaN),
                tiltAngle:parseFloat(data.v5 ?? data.V5 ?? NaN),
                tl: parseFloat(data.v6 ?? data.V6 ?? NaN),
                tr: parseFloat(data.v7 ?? data.V7 ?? NaN),
                bl: parseFloat(data.v8 ?? data.V8 ?? NaN),
                br: parseFloat(data.v9 ?? data.V9 ?? NaN),
            };
        }
    } catch { /* fall through to individual */ }

    // Fallback: fetch available pins individually
    const [v1, v2, v3, v4, v5, v6, v7, v8, v9] = await Promise.all([
        fetchSinglePin('v1'),
        fetchSinglePin('v2'),
        fetchSinglePin('v3'),
        fetchSinglePin('v4'),
        fetchSinglePin('v5'),
        fetchSinglePin('v6'),
        fetchSinglePin('v7'),
        fetchSinglePin('v8'),
        fetchSinglePin('v9'),
    ]);
    return {
        voltage:   v1,
        current:   v2,
        power:     v3,
        panAngle:  v4,
        tiltAngle: v5,
        tl: v6,
        tr: v7,
        bl: v8,
        br: v9,
    };
}

// ============================================
// Dashboard Update Logic
// ============================================
function getPanDirection(angle) {
    if (angle === null || isNaN(angle)) return { label: '--', icon: 'fa-compass' };
    if (angle < 60) return { label: 'East', icon: 'fa-arrow-left' };
    if (angle < 80) return { label: 'East-Center', icon: 'fa-arrow-left' };
    if (angle <= 100) return { label: 'Center', icon: 'fa-arrows-left-right' };
    if (angle <= 120) return { label: 'Center-West', icon: 'fa-arrow-right' };
    return { label: 'West', icon: 'fa-arrow-right' };
}

function getTiltDirection(angle) {
    if (angle === null || isNaN(angle)) return '--';
    if (angle < 70) return 'Tilted Up';
    if (angle <= 110) return 'Level';
    return 'Tilted Down';
}

function drawMiniSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    const max = Math.max(...data, 0.1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');

    ctx.beginPath();
    ctx.moveTo(0, h);
    data.forEach((val, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((val - min) / range) * (h - 4) - 2;
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line on top
    ctx.beginPath();
    data.forEach((val, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((val - min) / range) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
}

function applyReading(data) {
    const voltage = parseFloat(data.voltage ?? 0);
    const current = parseFloat(data.current_a ?? data.current ?? 0);
    const power = parseFloat(data.power ?? (voltage * current));
    const pan = parseInt(data.pan_angle ?? data.panAngle ?? 90);
    const tilt = parseInt(data.tilt_angle ?? data.tiltAngle ?? 90);

    ldrValues.tl = parseInt(data.ldr_tl ?? data.tl ?? 0);
    ldrValues.tr = parseInt(data.ldr_tr ?? data.tr ?? 0);
    ldrValues.bl = parseInt(data.ldr_bl ?? data.bl ?? 0);
    ldrValues.br = parseInt(data.ldr_br ?? data.br ?? 0);

    // Update metric cards
    elVoltage.textContent = `${voltage.toFixed(2)} V`;
    elCurrent.textContent = `${current.toFixed(2)} A`;
    elPower.textContent   = `${power.toFixed(2)} W`;

    // Pan angle with direction
    const panDir = getPanDirection(pan);
    elPan.textContent = `${Math.round(pan)}°`;
    if (elPanDir) {
        elPanDir.innerHTML = `<i class="fa-solid ${panDir.icon}"></i> ${panDir.label}`;
    }

    // Tilt angle with direction
    elTilt.textContent = `${Math.round(tilt)}°`;
    if (elTiltDir) {
        elTiltDir.textContent = getTiltDirection(tilt);
    }

    // Efficiency (simulated: based on how much power vs theoretical max 20V*5A=100W)
    if (elEfficiency) {
        const eff = Math.min(100, (power / 100) * 100);
        elEfficiency.textContent = `${eff.toFixed(1)}%`;
        // Update circular progress ring
        const ring = document.getElementById('efficiency-ring');
        if (ring) {
            const circumference = 2 * Math.PI * 52;
            ring.style.strokeDashoffset = circumference - (eff / 100) * circumference;
        }
    }

    // Update timestamp
    if (elTimestamp) {
        elTimestamp.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    }

    // Update history arrays for sparklines
    voltageHistory.push(voltage);
    currentHistory.push(current);
    powerHistory.push(power);
    if (voltageHistory.length > HISTORY_SIZE) voltageHistory.shift();
    if (currentHistory.length > HISTORY_SIZE) currentHistory.shift();
    if (powerHistory.length > HISTORY_SIZE)   powerHistory.shift();

    drawMiniSparkline('spark-voltage', voltageHistory, '#ff6384');
    drawMiniSparkline('spark-current', currentHistory, '#36a2eb');
    drawMiniSparkline('spark-power',   powerHistory,   '#4bc0c0');

    // Update 3D scene target angles
    currentPan  = pan;
    currentTilt = tilt;

    // Connection status
    elStatus.innerHTML = '<span class="dot"></span> All Systems Live';
    elStatus.className = 'status-badge live';

    // Update HUD Overlay elements with real-time sensor diagnostic readings
    const hudVoltage = document.getElementById('hud-val-voltage');
    const hudCurrent = document.getElementById('hud-val-current');
    const hudPan = document.getElementById('hud-val-pan');
    const hudTilt = document.getElementById('hud-val-tilt');
    const hudLdrTl = document.getElementById('hud-ldr-tl');
    const hudLdrTr = document.getElementById('hud-ldr-tr');
    const hudLdrBl = document.getElementById('hud-ldr-bl');
    const hudLdrBr = document.getElementById('hud-ldr-br');
    const hudSunX = document.getElementById('hud-sun-xbias');
    const hudSunY = document.getElementById('hud-sun-ybias');

    if (hudVoltage) hudVoltage.textContent = `${voltage.toFixed(2)} V`;
    if (hudCurrent) hudCurrent.textContent = `${current.toFixed(2)} A`;
    if (hudPan) hudPan.textContent = `${Math.round(pan)}°`;
    if (hudTilt) hudTilt.textContent = `${Math.round(tilt)}°`;
    
    if (hudLdrTl) hudLdrTl.textContent = Math.round(ldrValues.tl);
    if (hudLdrTr) hudLdrTr.textContent = Math.round(ldrValues.tr);
    if (hudLdrBl) hudLdrBl.textContent = Math.round(ldrValues.bl);
    if (hudLdrBr) hudLdrBr.textContent = Math.round(ldrValues.br);

    if (hudSunX && hudSunY) {
        const xBias = (ldrValues.tr + ldrValues.br) - (ldrValues.tl + ldrValues.bl);
        const yBias = (ldrValues.tl + ldrValues.tr) - (ldrValues.bl + ldrValues.br);
        hudSunX.textContent = (xBias / 1000).toFixed(2);
        hudSunY.textContent = (yBias / 1000).toFixed(2);
    }
}

async function updateDashboard() {
    try {
        const data = await fetchAllPins();
        if (!data || isNaN(data.voltage)) {
            throw new Error('No data or invalid data received');
        }
        applyReading({
            voltage: data.voltage,
            current_a: data.current,
            power: data.power,
            pan_angle: data.panAngle,
            tilt_angle: data.tiltAngle,
            ldr_tl: data.tl,
            ldr_tr: data.tr,
            ldr_bl: data.bl,
            ldr_br: data.br
        });
    } catch (error) {
        console.error('Dashboard update error:', error);
        elStatus.innerHTML = '<span class="dot error blinking"></span> Connection Error';
        elStatus.className = 'status-badge error';
    }
}

let ws = null;
function initWebSocket() {
    const wsHost = window.location.hostname || 'localhost';
    const wsUrl = `ws://${wsHost}:8082`;
    console.log(`Connecting to WebSocket at ${wsUrl}`);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connected.');
        if (window._pollInterval) {
            clearInterval(window._pollInterval);
            window._pollInterval = null;
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'reading') {
                applyReading(msg.data);
            }
        } catch (err) {
            console.error('Error parsing WebSocket message:', err);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed. Activating Blynk fallback polling.');
        elStatus.innerHTML = '<span class="dot warning blinking"></span> WS Offline. Polling Blynk...';
        elStatus.className = 'status-badge warning';

        if (window._pollInterval) clearInterval(window._pollInterval);
        
        // Poll direct Blynk REST API every 3s
        window._pollInterval = setInterval(() => {
            updateDashboard();
        }, 3000);

        // Attempt reconnection to WebSocket after 10s
        setTimeout(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                initWebSocket();
            }
        }, 10000);
    };
}

let historyCharts = {};
async function initHistoryCharts() {
    try {
        const res = await fetch('/api/history?device_id=2207062&hours=6');
        if (!res.ok) throw new Error('Failed to fetch history');
        const rows = await res.json();

        const labels  = rows.map(r => new Date(r.recorded_at).toLocaleTimeString());
        const voltage = rows.map(r => r.voltage);
        const current = rows.map(r => r.current_a);
        const power   = rows.map(r => r.power);

        const chartOpts = (label, color, data) => ({
            type: 'line',
            data: {
                labels,
                datasets: [{ 
                    label, 
                    data, 
                    borderColor: color, 
                    tension: 0.3,
                    fill: true, 
                    backgroundColor: color + '18', 
                    pointRadius: 0 
                }]
            },
            options: { 
                responsive: true, 
                plugins: { legend: { display: false } },
                scales: { x: { display: false } } 
            }
        });

        if (historyCharts.voltage) historyCharts.voltage.destroy();
        if (historyCharts.current) historyCharts.current.destroy();
        if (historyCharts.power) historyCharts.power.destroy();

        historyCharts.voltage = new Chart(document.getElementById('history-voltage'), chartOpts('Voltage', '#ff6384', voltage));
        historyCharts.current = new Chart(document.getElementById('history-current'), chartOpts('Current', '#36a2eb', current));
        historyCharts.power = new Chart(document.getElementById('history-power'),   chartOpts('Power',   '#4bc0c0', power));
    } catch (err) {
        console.error('Error initializing history charts:', err);
    }
}

// ============================================
// 3D Scene — Premium Solar Panel Visualization
// ============================================
function init3D() {
    const container = document.getElementById('3d-container');
    if (!container) return;

    // Gracefully handle Three.js library failing to load (e.g. user offline / CDN blocked)
    if (typeof THREE === 'undefined') {
        console.error('Three.js library is not loaded. 3D simulation disabled.');
        container.innerHTML = `
            <div class="sim-error-message" style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: var(--accent-pink);
                gap: 12px;
                padding: 24px;
                text-align: center;
                background: rgba(10, 14, 26, 0.6);
                backdrop-filter: blur(8px);
                border-radius: var(--radius-sm);
            ">
                <i class="fa-solid fa-circle-exclamation" style="font-size: 2.2rem; filter: drop-shadow(0 0 10px rgba(255, 99, 132, 0.4));"></i>
                <h3 style="font-size: 1.1rem; font-weight: 600; margin: 0; letter-spacing: 0.5px;">3D Simulation Offline</h3>
                <p style="font-size: 0.8rem; color: var(--text-secondary); max-width: 280px; margin: 0; line-height: 1.5;">
                    The 3D visualization engine (Three.js) could not be loaded. Please check your internet connection or verify the library source.
                </p>
            </div>
        `;
        return;
    }

    // Safely determine initial container dimensions to avoid NaN aspect ratio and 0x0 canvas crashes
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 300;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1a, 0.015);

    // Camera
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    updateCameraPosition();

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x334466, 0.4);
    scene.add(ambientLight);

    sunLight = new THREE.DirectionalLight(0xffddaa, 1.2);
    sunLight.position.set(15, 30, 10);
    sunLight.castShadow = true;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 80;
    sunLight.shadow.camera.left = -20;
    sunLight.shadow.camera.right = 20;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -20;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    scene.add(sunLight);

    // Hemisphere light for sky/ground color
    const hemiLight = new THREE.HemisphereLight(0x88aacc, 0x222244, 0.3);
    scene.add(hemiLight);

    // Create the visual Sun (a yellow glowing sphere)
    const sunGeom = new THREE.SphereGeometry(0.5, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff333 });
    sunSphere = new THREE.Mesh(sunGeom, sunMat);
    sunSphere.position.y = 5; // Start it hovering near the panel
    scene.add(sunSphere);

    // Add a point light to the sun so it actually illuminates the panel
    const sunLightSource = new THREE.PointLight(0xffffff, 2, 50);
    sunSphere.add(sunLightSource);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a2e,
        roughness: 0.9,
        metalness: 0.1
    });
    ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Ground grid
    const gridHelper = new THREE.GridHelper(60, 30, 0x222244, 0x111133);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Base (cylindrical support)
    const baseGeo = new THREE.CylinderGeometry(0.8, 1.2, 5, 16);
    const baseMat = new THREE.MeshStandardMaterial({ 
        color: 0x444466, 
        roughness: 0.5, 
        metalness: 0.6 
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 2.5;
    base.castShadow = true;
    scene.add(base);

    // Pan joint (rotates left/right)
    pivot = new THREE.Group();
    pivot.position.y = 5;
    scene.add(pivot);

    // Arm connecting base to panel
    const armGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.5, 8);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x556688, metalness: 0.7, roughness: 0.3 });
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.y = 0.5;
    arm.castShadow = true;
    pivot.add(arm);

    // Tilt group to hold frame, panel, and grid so they rotate together
    solarPanel = new THREE.Group();
    solarPanel.position.y = 1.5;
    pivot.add(solarPanel);

    // Panel frame
    const frameGeo = new THREE.BoxGeometry(12, 0.15, 8);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.5, roughness: 0.4 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 0;
    frame.castShadow = true;
    solarPanel.add(frame);

    // Solar cells (dark blue reflective surface)
    const panelGeo = new THREE.BoxGeometry(11.5, 0.08, 7.5);
    const panelMat = new THREE.MeshPhongMaterial({
        color: 0x112244,
        specular: 0x4488bb,
        shininess: 120,
        reflectivity: 0.8,
    });
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    panelMesh.position.y = 0.1;
    panelMesh.castShadow = true;
    solarPanel.add(panelMesh);

    // Grid lines to simulate individual solar cells
    const cellGrid = new THREE.GridHelper(11.5, 6, 0x223355, 0x223355);
    cellGrid.position.y = 0.15;
    cellGrid.rotation.x = 0; // Already horizontal as a grid helper
    solarPanel.add(cellGrid);

    // Compass rose on ground
    createCompassRose();

    // Direction labels
    createDirectionLabels();

    // Create physical LDR indicators on the corners of the panel
    const ldrGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 8);
    const ldrMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.8, roughness: 0.3 });
    const bulbGeo = new THREE.SphereGeometry(0.22, 16, 16);
    
    // Corners matching TL, TR, BL, BR
    const ldrCorners = [
        { name: 'tl', x: -5.5, z: -3.5, color: 0xff3344, labelName: 'TL (E/Up)' },
        { name: 'tr', x: 5.5, z: -3.5, color: 0x33ff66, labelName: 'TR (W/Up)' },
        { name: 'bl', x: -5.5, z: 3.5, color: 0x3388ff, labelName: 'BL (E/Dn)' },
        { name: 'br', x: 5.5, z: 3.5, color: 0xffaa00, labelName: 'BR (W/Dn)' }
    ];

    ldrMeshes = {};

    ldrCorners.forEach(c => {
        const ldrGroup = new THREE.Group();
        ldrGroup.position.set(c.x, 0.2, c.z);
        
        // Holder cylinder
        const baseMesh = new THREE.Mesh(ldrGeo, ldrMat);
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        ldrGroup.add(baseMesh);
        
        // Glowing bulb mesh on top
        const bulbMat = new THREE.MeshBasicMaterial({ color: c.color });
        const bulbMesh = new THREE.Mesh(bulbGeo, bulbMat);
        bulbMesh.position.y = 0.25;
        ldrGroup.add(bulbMesh);
        
        // Add a floating text label canvas sprite above it
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 16px Outfit, sans-serif';
        ctx.fillStyle = '#f0f4f8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.labelName, 64, 16);
        
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(0, 0.75, 0);
        sprite.scale.set(3.2, 0.8, 1);
        ldrGroup.add(sprite);

        solarPanel.add(ldrGroup);
        
        // Store bulb references to dynamically control emissive glow in animate()
        ldrMeshes[c.name] = {
            bulb: bulbMesh,
            baseColor: c.color
        };
    });

    // Create a real-time HUD telemetry diagnostic overlay inside the 3D container
    const hud = document.createElement('div');
    hud.id = '3d-hud';
    hud.style.position = 'absolute';
    hud.style.top = '12px';
    hud.style.left = '12px';
    hud.style.right = '12px';
    hud.style.bottom = '12px';
    hud.style.pointerEvents = 'none'; // Clicks pass through to orbit controls
    hud.style.display = 'flex';
    hud.style.flexDirection = 'column';
    hud.style.justifyContent = 'space-between';
    hud.style.fontFamily = "'Outfit', sans-serif";
    hud.innerHTML = `
        <!-- Top HUD Row -->
        <div style="display: flex; justify-content: space-between; pointer-events: auto;">
            <!-- Diagnostics Panel -->
            <div style="
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 10px 14px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            ">
                <span style="font-size: 0.65rem; color: var(--accent-cyan); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Sensor Diagnostics</span>
                <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; font-size: 0.75rem;">
                    <span style="color: var(--text-secondary);">Voltage:</span><span id="hud-val-voltage" style="color: #ff6384; font-weight: 600; font-family: monospace;">-- V</span>
                    <span style="color: var(--text-secondary);">Current:</span><span id="hud-val-current" style="color: #36a2eb; font-weight: 600; font-family: monospace;">-- A</span>
                </div>
            </div>
            
            <!-- Sun Position / Tracking Bias Panel -->
            <div style="
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 10px 14px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                align-items: flex-end;
            ">
                <span style="font-size: 0.65rem; color: var(--accent-orange); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Sun Tracking Bias</span>
                <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; font-size: 0.75rem; text-align: right;">
                    <span style="color: var(--text-secondary);">Azimuth (E/W):</span><span id="hud-sun-xbias" style="color: var(--text-primary); font-weight: 600; font-family: monospace;">0.00</span>
                    <span style="color: var(--text-secondary);">Elevation (U/D):</span><span id="hud-sun-ybias" style="color: var(--text-primary); font-weight: 600; font-family: monospace;">0.00</span>
                </div>
            </div>
        </div>
        
        <!-- Bottom HUD Row -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; pointer-events: auto;">
            <!-- LDR Matrix Panel -->
            <div style="
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 10px 12px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                display: flex;
                flex-direction: column;
                gap: 6px;
            ">
                <span style="font-size: 0.65rem; color: var(--accent-teal); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;">2x2 LDR Sensor Grid</span>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 0.7rem; font-family: monospace; text-align: center;">
                    <div style="background: rgba(255, 99, 132, 0.1); border: 1px solid rgba(255, 99, 132, 0.2); border-radius: 4px; padding: 2px 6px; color: #ff6384;">
                        TL: <span id="hud-ldr-tl">0</span>
                    </div>
                    <div style="background: rgba(54, 162, 235, 0.1); border: 1px solid rgba(54, 162, 235, 0.2); border-radius: 4px; padding: 2px 6px; color: #36a2eb;">
                        TR: <span id="hud-ldr-tr">0</span>
                    </div>
                    <div style="background: rgba(153, 102, 255, 0.1); border: 1px solid rgba(153, 102, 255, 0.2); border-radius: 4px; padding: 2px 6px; color: #9966ff;">
                        BL: <span id="hud-ldr-bl">0</span>
                    </div>
                    <div style="background: rgba(255, 159, 64, 0.1); border: 1px solid rgba(255, 159, 64, 0.2); border-radius: 4px; padding: 2px 6px; color: #ff9f40;">
                        BR: <span id="hud-ldr-br">0</span>
                    </div>
                </div>
            </div>
            
            <!-- Angle Telemetry Panel -->
            <div style="
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                padding: 10px 14px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 2px;
            ">
                <span style="font-size: 0.65rem; color: var(--accent-purple); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Panel Heading</span>
                <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-primary);">
                    Pan (Azimuth): <span id="hud-val-pan" style="font-family: monospace;">--°</span>
                </span>
                <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-primary);">
                    Tilt (Elevation): <span id="hud-val-tilt" style="font-family: monospace;">--°</span>
                </span>
            </div>
        </div>
    `;
    container.appendChild(hud);

    // Mouse orbit controls (manual)
    container.addEventListener('mousedown', (e) => { isMouseDown = true; });
    window.addEventListener('mouseup', () => { isMouseDown = false; });
    container.addEventListener('mousemove', (e) => {
        if (isMouseDown) {
            cameraAngle += e.movementX * 0.005;
            cameraElevation = Math.max(0.1, Math.min(1.2, cameraElevation - e.movementY * 0.005));
            updateCameraPosition();
        }
    });
    container.addEventListener('wheel', (e) => {
        cameraDistance = Math.max(15, Math.min(60, cameraDistance + e.deltaY * 0.05));
        updateCameraPosition();
        e.preventDefault();
    }, { passive: false });

    // Animation loop
    animate();

    // Resize handler using ResizeObserver (robust for flexbox)
    const resizeObserver = new ResizeObserver(() => {
        if (!container.clientWidth || !container.clientHeight) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);
}

function updateCameraPosition() {
    const x = cameraDistance * Math.cos(cameraElevation) * Math.sin(cameraAngle);
    const y = cameraDistance * Math.sin(cameraElevation);
    const z = cameraDistance * Math.cos(cameraElevation) * Math.cos(cameraAngle);
    camera.position.set(x, Math.max(y, 3), z);
    camera.lookAt(0, 3, 0);
}

function createCompassRose() {
    // Simple compass lines on the ground
    const material = new THREE.LineBasicMaterial({ color: 0x445566 });

    // N-S line
    const nsGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.01, -15),
        new THREE.Vector3(0, 0.01, 15),
    ]);
    scene.add(new THREE.Line(nsGeo, material));

    // E-W line
    const ewGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-15, 0.01, 0),
        new THREE.Vector3(15, 0.01, 0),
    ]);
    scene.add(new THREE.Line(ewGeo, material));
}

function createDirectionLabels() {
    // Using simple sprite text labels for NSEW
    const directions = [
        { text: 'N', pos: [0, 0.5, -16] },
        { text: 'S', pos: [0, 0.5, 16] },
        { text: 'E', pos: [-16, 0.5, 0] },
        { text: 'W', pos: [16, 0.5, 0] },
    ];

    directions.forEach(d => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 40px Outfit, sans-serif';
        ctx.fillStyle = '#556688';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.set(...d.pos);
        sprite.scale.set(2, 2, 1);
        scene.add(sprite);
    });
}

function animate() {
    requestAnimationFrame(animate);

    if (pivot && solarPanel && sunSphere) {
        // Map servo angles (0-180) to radians, centered at 90° = 0 rad
        const targetPanRad  = ((currentPan - 90) * Math.PI) / 180;
        const targetTiltRad = -((currentTilt - 90) * Math.PI) / 180;

        // Smooth interpolation
        pivot.rotation.y += (targetPanRad - pivot.rotation.y) * 0.1;
        solarPanel.rotation.x += (targetTiltRad - solarPanel.rotation.x) * 0.1;

        if (!isTestModeActive) {
            // Calculate Sun Position based on LDRs
            const xBias = (ldrValues.tr + ldrValues.br) - (ldrValues.tl + ldrValues.bl);
            const yBias = (ldrValues.tl + ldrValues.tr) - (ldrValues.bl + ldrValues.br);

            // Move the sun sphere to the side where LDRs are brighter
            const targetSunX = (xBias / 1000) * 5;
            const targetSunY = 5 + (yBias / 1000) * 5; // Offset by 5 so it stays in the air
            
            sunSphere.position.x += (targetSunX - sunSphere.position.x) * 0.05;
            sunSphere.position.y += (targetSunY - sunSphere.position.y) * 0.05;
            sunSphere.position.z = 8;
        }

        // Update physical LDR indicator bulb colors based on Blynk readings (0-4095 range)
        if (ldrMeshes && Object.keys(ldrMeshes).length > 0) {
            Object.keys(ldrMeshes).forEach(key => {
                const val = ldrValues[key] || 0;
                // Map 0-4095 to 0.2-1.8 color intensity
                const intensity = 0.2 + (Math.min(val, 4095) / 4095) * 1.6;
                
                const color = new THREE.Color(ldrMeshes[key].baseColor);
                color.multiplyScalar(intensity);
                ldrMeshes[key].bulb.material.color = color;
            });
        }
    }

    renderer.render(scene, camera);
}

// ============================================
// Sidebar Navigation (SPA-like tab switching)
// ============================================
function initNavigation() {
    const navLinks = document.querySelectorAll('.sidebar nav a');
    const pages = document.querySelectorAll('.page');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const target = link.getAttribute('data-page');
            if (!target) {
                // Let the natural navigation happen (for the Admin link pointing to /admin.html)
                return;
            }
            
            e.preventDefault();
            
            // Remove active from all
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            pages.forEach(p => {
                p.classList.toggle('active', p.id === target);
            });

            // Trigger custom page load routines
            if (target === 'page-history') {
                initHistoryCharts();
            }
        });
    });
}

// ============================================
// Settings Page Logic
// ============================================
function initSettings() {
    const refreshSlider = document.getElementById('refresh-rate');
    const refreshLabel = document.getElementById('refresh-label');
    if (refreshSlider) {
        refreshSlider.addEventListener('input', () => {
            const val = refreshSlider.value;
            refreshLabel.textContent = `${val}ms`;
            // Clear old interval, set new one
            clearInterval(window._pollInterval);
            window._pollInterval = setInterval(updateDashboard, parseInt(val));
        });
    }
}

// ============================================
// ============================================
// Interactive Sun Tracking Simulator Mode
// ============================================
let isTestModeActive = false;
let simAzimuth = 45;    // 0 = East, 90 = South (Zenith), 180 = West
let simElevation = 30;  // 5 to 90 degrees
let isAutoOrbit = false;
let orbitTime = 0.0;
let simLoopInterval = null;
let simulatedPan = 90;
let simulatedTilt = 90;

function initTestSimulator() {
    const btnTestMode = document.getElementById('btn-test-mode');
    const btnStopSim = document.getElementById('btn-stop-sim');
    const panel = document.getElementById('test-simulator-panel');
    const connStatus = document.getElementById('conn-status');

    if (!btnTestMode || !panel) return;

    // Range controls
    const sliderAzimuth = document.getElementById('sim-azimuth');
    const sliderElevation = document.getElementById('sim-elevation');
    const lblAzimuth = document.getElementById('lbl-sim-azimuth');
    const lblElevation = document.getElementById('lbl-sim-elevation');

    // Preset buttons
    const presetBtns = document.querySelectorAll('.sim-preset-btn');

    // Action toggling
    btnTestMode.addEventListener('click', () => {
        enableTestMode();
    });

    btnStopSim.addEventListener('click', () => {
        disableTestMode();
    });

    // Preset selection
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const preset = btn.getAttribute('data-preset');
            isAutoOrbit = (preset === 'dynamic');

            if (preset === 'east') {
                simAzimuth = 30;
                simElevation = 25;
            } else if (preset === 'zenith') {
                simAzimuth = 90;
                simElevation = 85;
            } else if (preset === 'west') {
                simAzimuth = 150;
                simElevation = 25;
            }

            if (!isAutoOrbit) {
                sliderAzimuth.value = simAzimuth;
                sliderElevation.value = simElevation;
                lblAzimuth.textContent = `${simAzimuth}°`;
                lblElevation.textContent = `${simElevation}°`;
            } else {
                orbitTime = 0.0;
            }

            logEvent('info', `Simulator preset changed: ${preset.toUpperCase()}`);
        });
    });

    // Manual slider changes
    const handleSliderInput = () => {
        // Pause auto-orbit on manual slider slide
        if (isAutoOrbit) {
            isAutoOrbit = false;
            presetBtns.forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-preset') === 'manual');
            });
        }
        simAzimuth = parseInt(sliderAzimuth.value);
        simElevation = parseInt(sliderElevation.value);
        lblAzimuth.textContent = `${simAzimuth}°`;
        lblElevation.textContent = `${simElevation}°`;
    };

    sliderAzimuth.addEventListener('input', handleSliderInput);
    sliderElevation.addEventListener('input', handleSliderInput);

    function enableTestMode() {
        isTestModeActive = true;
        panel.style.display = 'block';
        btnTestMode.style.display = 'none';

        // Update status badge
        connStatus.innerHTML = '<span class="dot warning blinking"></span> SIMULATOR TEST ACTIVE';
        connStatus.className = 'status-badge warning';

        // Reset positions
        simulatedPan = 90;
        simulatedTilt = 90;

        // Clear regular network polling
        clearInterval(window._pollInterval);

        // Start local simulation loop (runs tracking & physics math at 60fps equivalent)
        simLoopInterval = setInterval(runSimulationTick, 80);

        logEvent('warning', 'Simulation Test Mode Enabled. Offline physics simulation running.');
    }

    function disableTestMode() {
        isTestModeActive = false;
        panel.style.display = 'none';
        btnTestMode.style.display = 'inline-flex';

        // Clear simulation loop
        clearInterval(simLoopInterval);

        // Restore normal polling
        connStatus.innerHTML = '<span class="dot blinking"></span> Connecting to Blynk...';
        connStatus.className = 'status-badge';
        updateDashboard();

        const refreshRate = document.getElementById('refresh-rate')?.value || 2000;
        window._pollInterval = setInterval(updateDashboard, parseInt(refreshRate));

        logEvent('info', 'Simulation Test Mode Disabled. Blynk live connection restored.');
    }

    function runSimulationTick() {
        if (!isTestModeActive) return;

        // 1. Advance auto-orbit
        if (isAutoOrbit) {
            orbitTime += 0.015;
            // Cycle azimuth smoothly from East (15°) to West (165°)
            simAzimuth = Math.round(90 - Math.cos(orbitTime) * 75);
            // Cycle elevation from 15° to 75°
            simElevation = Math.round(45 + Math.sin(orbitTime) * 30);

            sliderAzimuth.value = simAzimuth;
            sliderElevation.value = simElevation;
            lblAzimuth.textContent = `${simAzimuth}°`;
            lblElevation.textContent = `${simElevation}°`;
        }

        // 2. Physics Model: calculate sensor LDR outputs based on alignment offset
        const azRad = (simAzimuth * Math.PI) / 180;
        const elRad = (simElevation * Math.PI) / 180;
        const panRad = -((simulatedPan - 90) * Math.PI) / 180;
        const tiltRad = -((simulatedTilt - 90) * Math.PI) / 180;

        // Calculate angular offsets in degrees
        const azDiff = simAzimuth - simulatedPan;
        const elDiff = simElevation - simulatedTilt;

        // Simulating highly accurate photodiode response curves
        // When sun aligns with simulated angles, intensities peak
        // LDR values: TR, TL, BR, BL (range 0 to 4095)
        const baseIntensity = 2200 * Math.sin(elRad); // Sun is brighter when higher in sky
        const noise = () => (Math.random() - 0.5) * 15; // Random voltage ripple noise

        // Left LDRs (TL, BL) see more light when Sun is West of Panel (simAzimuth < simulatedPan)
        // Top LDRs (TL, TR) see more light when Sun is Higher than Panel (simElevation > simulatedTilt)
        ldrValues.tr = Math.max(120, Math.min(4080, Math.round(baseIntensity + azDiff * 14 + elDiff * 14 + noise())));
        ldrValues.tl = Math.max(120, Math.min(4080, Math.round(baseIntensity - azDiff * 14 + elDiff * 14 + noise())));
        ldrValues.br = Math.max(120, Math.min(4080, Math.round(baseIntensity + azDiff * 14 - elDiff * 14 + noise())));
        ldrValues.bl = Math.max(120, Math.min(4080, Math.round(baseIntensity - azDiff * 14 - elDiff * 14 + noise())));

        // 3. Simulated ESP32 Controller Closed-Loop Logic
        const avgTop = (ldrValues.tl + ldrValues.tr) / 2;
        const avgBot = (ldrValues.bl + ldrValues.br) / 2;
        const avgLeft = (ldrValues.tl + ldrValues.bl) / 2;
        const avgRight = (ldrValues.tr + ldrValues.br) / 2;

        let moved = false;
        const stepSize = 3; // Smooth step size for simulator refresh rate (80ms)

        // Pan axis (Left/Right)
        if (avgLeft > avgRight + 30) {
            simulatedPan = Math.max(0, simulatedPan - stepSize);
            moved = true;
        } else if (avgRight > avgLeft + 30) {
            simulatedPan = Math.min(180, simulatedPan + stepSize);
            moved = true;
        }

        // Tilt axis (Up/Down)
        if (avgTop > avgBot + 30) {
            simulatedTilt = Math.min(180, simulatedTilt + stepSize);
            moved = true;
        } else if (avgBot > avgTop + 30) {
            simulatedTilt = Math.max(0, simulatedTilt - stepSize);
            moved = true;
        }

        // Write positions to visual model
        currentPan = simulatedPan;
        currentTilt = simulatedTilt;

        // 4. Calculate Cosine Efficiency & Power Output
        // Peak alignment is when Pan = Azimuth and Tilt = Elevation
        const panDiffRad = ((simulatedPan - simAzimuth) * Math.PI) / 180;
        const tiltDiffRad = ((simulatedTilt - simElevation) * Math.PI) / 180;
        const cosTheta = Math.max(0, Math.cos(panDiffRad) * Math.cos(tiltDiffRad));

        const efficiency = cosTheta * 100;
        // Peak panel capability scales with Sun elevation (less atmospheric loss)
        const peakPower = 92 * Math.sin(elRad); // Maximum 92 Watts at zenith
        const power = Math.max(0.5, peakPower * Math.pow(cosTheta, 1.8) + 1.2); // Exponential drop-off
        const voltage = Math.max(1.5, 12 + cosTheta * 6.8 * Math.sin(elRad) + (Math.random() - 0.5) * 0.08); 
        const current = power / voltage;

        // 5. Update Web Dashboard Metric UI Cards
        elVoltage.textContent = `${voltage.toFixed(2)} V`;
        elCurrent.textContent = `${current.toFixed(2)} A`;
        elPower.textContent = `${power.toFixed(2)} W`;

        const panDir = getPanDirection(simulatedPan);
        elPan.textContent = `${Math.round(simulatedPan)}°`;
        if (elPanDir) {
            elPanDir.innerHTML = `<i class="fa-solid ${panDir.icon}"></i> ${panDir.label}`;
        }
        elTilt.textContent = `${Math.round(simulatedTilt)}°`;
        if (elTiltDir) {
            elTiltDir.textContent = getTiltDirection(simulatedTilt);
        }

        // Update efficiency circular ring
        elEfficiency.textContent = `${efficiency.toFixed(1)}%`;
        const ring = document.getElementById('efficiency-ring');
        if (ring) {
            const circumference = 2 * Math.PI * 52;
            ring.style.strokeDashoffset = circumference - (efficiency / 100) * circumference;
        }

        // Update timestamp label
        if (elTimestamp) {
            elTimestamp.textContent = `SIM TIME: ${new Date().toLocaleTimeString()}`;
        }

        // Update sparkline histories
        voltageHistory.push(voltage);
        currentHistory.push(current);
        powerHistory.push(power);
        if (voltageHistory.length > HISTORY_SIZE) voltageHistory.shift();
        if (currentHistory.length > HISTORY_SIZE) currentHistory.shift();
        if (powerHistory.length > HISTORY_SIZE)   powerHistory.shift();

        drawMiniSparkline('spark-voltage', voltageHistory, '#ff6384');
        drawMiniSparkline('spark-current', currentHistory, '#36a2eb');
        drawMiniSparkline('spark-power',   powerHistory,   '#4bc0c0');

        // 6. Update HUD Elements
        const hudVoltage = document.getElementById('hud-val-voltage');
        const hudCurrent = document.getElementById('hud-val-current');
        const hudPan = document.getElementById('hud-val-pan');
        const hudTilt = document.getElementById('hud-val-tilt');
        const hudLdrTl = document.getElementById('hud-ldr-tl');
        const hudLdrTr = document.getElementById('hud-ldr-tr');
        const hudLdrBl = document.getElementById('hud-ldr-bl');
        const hudLdrBr = document.getElementById('hud-ldr-br');
        const hudSunX = document.getElementById('hud-sun-xbias');
        const hudSunY = document.getElementById('hud-sun-ybias');

        if (hudVoltage) hudVoltage.textContent = `${voltage.toFixed(2)} V`;
        if (hudCurrent) hudCurrent.textContent = `${current.toFixed(2)} A`;
        if (hudPan) hudPan.textContent = `${Math.round(simulatedPan)}°`;
        if (hudTilt) hudTilt.textContent = `${Math.round(simulatedTilt)}°`;
        if (hudLdrTl) hudLdrTl.textContent = Math.round(ldrValues.tl);
        if (hudLdrTr) hudLdrTr.textContent = Math.round(ldrValues.tr);
        if (hudLdrBl) hudLdrBl.textContent = Math.round(ldrValues.bl);
        if (hudLdrBr) hudLdrBr.textContent = Math.round(ldrValues.br);

        if (hudSunX && hudSunY) {
            const xBias = (ldrValues.tr + ldrValues.br) - (ldrValues.tl + ldrValues.bl);
            const yBias = (ldrValues.tl + ldrValues.tr) - (ldrValues.bl + ldrValues.br);
            hudSunX.textContent = (xBias / 1000).toFixed(2);
            hudSunY.textContent = (yBias / 1000).toFixed(2);
        }

        // Update simulator feedback card labels
        const lblError = document.getElementById('lbl-sim-error');
        const lblCos = document.getElementById('lbl-sim-cos');
        const trackingOffset = Math.sqrt(Math.pow(azDiff, 2) + Math.pow(elDiff, 2));

        if (lblError) {
            lblError.textContent = `${trackingOffset.toFixed(1)}°`;
            lblError.style.color = trackingOffset < 5 ? '#33ff66' : (trackingOffset < 20 ? 'var(--accent-orange)' : '#ff6384');
        }
        if (lblCos) {
            lblCos.textContent = cosTheta.toFixed(3);
        }

        // 7. Update 3D scene physical Sun position (in test mode only, override normal calculation)
        if (sunSphere && isTestModeActive) {
            // Project spherical angles to 3D Cartesian coordinates
            const simSunX = -Math.cos(azRad) * Math.cos(elRad) * 15;
            const simSunY = Math.sin(elRad) * 15;
            const simSunZ = Math.sin(azRad) * Math.cos(elRad) * 15;
            
            // Instantly place the sun to reflect exact slider values
            sunSphere.position.set(simSunX, simSunY, simSunZ);
        }
    }
}

// ============================================
// Admin Page — Event Log
// ============================================
const eventLog = [];
async function logEvent(type, message) {
    const ts = new Date().toLocaleTimeString();
    eventLog.unshift({ ts, type, message });
    if (eventLog.length > 50) eventLog.pop();
    await renderEventLog();

    // Also persist to server
    try {
        await fetch('/api/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: '2207062', level: type, message })
        });
    } catch (err) {
        console.error("Failed to persist alert to server:", err);
    }
}

async function renderEventLog() {
    const container = document.getElementById('event-log');
    if (!container) return;

    try {
        const res = await fetch('/api/alerts?device_id=2207062&limit=50');
        if (res.ok) {
            const alerts = await res.json();
            container.innerHTML = alerts.map(e => `
                <div class="log-entry ${e.level}">
                    <span class="log-time">${new Date(e.created_at).toLocaleTimeString()}</span>
                    <span class="log-type">${e.level.toUpperCase()}</span>
                    <span class="log-msg">${e.message}</span>
                </div>
            `).join('');
            return;
        }
    } catch (err) {
        // Fall back to local rendering
    }

    container.innerHTML = eventLog.map(e => `
        <div class="log-entry ${e.type}">
            <span class="log-time">${e.ts}</span>
            <span class="log-type">${e.type.toUpperCase()}</span>
            <span class="log-msg">${e.message}</span>
        </div>
    `).join('');
}

// ============================================
// Initialize Everything
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    init3D();
    initNavigation();
    initSettings();
    initTestSimulator();

    // Start WebSocket connection (real-time telemetry)
    initWebSocket();

    // Initial fetch to populate UI immediately on load
    updateDashboard();
    logEvent('info', 'Dashboard initialized, starting WebSockets...');
});
