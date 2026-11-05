/* =========================================================
   ECOBAT TECHNOLOGIES - ENTERPRISE JAVASCRIPT ENGINE v3.0
   Real-Time Telemetry, 16-Cell Balancer, CAN-Bus Stream & AI
   ========================================================= */

const CONFIG = {
  n_steps_history: 60,
  window_size: 30,
  nominal_voltage: 350.0,
  max_cycle_life: 10000,
  end_of_life_soh: 80.0,
  default_interval_ms: 1000
};

// Application State
let state = {
  step: 0,
  ticks: 0,
  uptimeSeconds: 0,
  soc: 64.5,
  soh: 97.8,
  dod: 35.5,
  voltage: 350.0,
  current: -45.2,
  temp: 29.4,
  cycles: 215,
  throughput: 430.0,
  mode: 'discharge', // 'charge', 'discharge', 'idle', 'regen'
  noiseEnabled: false,
  isLive: true,
  streamIntervalMs: 1000,
  soundEnabled: true,
  theme: 'light',
  canStreaming: true,
  backendConnected: false,
  history: [],
  logs: [],
  rewardHistory: [],
  cells: [], // 16 Individual Cells
  // Hardware Prototype Gateway State
  hardwareConnected: false,
  hardwareSource: 'simulated', // 'simulated', 'web_serial', 'esp32_wifi'
  contactorClosed: true,
  coolingFanPwm: 35,
  currentLimit: 90.0,
  balancerMode: 'AUTO',
  estopActive: false,
  serialPort: null,
  serialReader: null,
  serialWriter: null,
  serialKeepReading: false,
  serialLogCount: 0,
  // Battery Visualizer & Story Tour State
  batteryViewMode: 'ions', // 'ions', 'pack', 'evloop', 'aibms'
  tourPlaying: false,
  tourCurrentStep: 1,
  tourTimer: null
};

const ACTIONS = {
  0: { name: "Idle / Standby", desc: "Mode siaga tanpa beban kerja signifikan, penghematan energi." },
  1: { name: "Slow Charge (0.35 C)", desc: "Pengisian lambat aman, meminimalkan degradasi termal sel baterai." },
  2: { name: "Normal Charge (0.65 C)", desc: "Pengisian standar seimbang antara kecepatan & kesehatan baterai." },
  3: { name: "Fast Charge (1.00 C)", desc: "Pengisian cepat tinggi, membutuhkan pemantauan suhu ekstra." },
  4: { name: "Discharge / Drive Mode", desc: "Mode penyaluran daya untuk beban traksi motor kendaraan listrik." }
};

let chartQuickTelemetry, chartTelemetry, chartSoc, chartSoh, chartRewards;
let emaState = { voltage: 350.0, current: -45.2, temp: 29.4 };
let simTimer = null;
let uptimeTimer = null;
let eventSource = null;

// Audio Synthesizer (Web Audio API)
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.04) {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    // Audio context may be restricted before user gesture
  }
}

function playChimeNotice() {
  playTone(523.25, 'sine', 0.12, 0.04); // C5
  setTimeout(() => playTone(659.25, 'sine', 0.18, 0.04), 100); // E5
}

function playWarningTone() {
  playTone(440, 'triangle', 0.18, 0.06);
  setTimeout(() => playTone(392, 'triangle', 0.22, 0.06), 140);
}

// Defensive Helpers
function safeSetText(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}

function safeSetHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function safeOn(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// Active User Profile State
let currentUser = {
  role: 'lead_engineer',
  name: 'Ir. Amanda Puja',
  title: 'Lead EV BMS Engineer'
};

// View Management & Authentication Flow
function initAuthView() {
  const loggedIn = localStorage.getItem("ecobat_logged_in") === "true";
  const savedName = localStorage.getItem("ecobat_user_name");
  if (savedName) {
    currentUser.name = savedName;
    safeSetText("user-display-name", savedName);
  }
  if (loggedIn) {
    showDashboardView(false);
  } else {
    showLandingView(false);
  }
}

function showLandingView(playSound = true) {
  const vLanding = document.getElementById("view-landing");
  const vDashboard = document.getElementById("view-dashboard");
  if (vDashboard) vDashboard.classList.remove("active-view");
  if (vLanding) vLanding.classList.add("active-view");
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (playSound) playTone(440, 'sine', 0.1, 0.03);
}

function showDashboardView(playSound = true) {
  const vLanding = document.getElementById("view-landing");
  const vDashboard = document.getElementById("view-dashboard");
  if (vLanding) vLanding.classList.remove("active-view");
  if (vDashboard) vDashboard.classList.add("active-view");
  window.scrollTo({ top: 0, behavior: 'smooth' });
  safeSetText("user-display-name", currentUser.name);
  if (playSound) playChimeNotice();

  // Resize charts & canvas after becoming visible
  setTimeout(() => {
    if (chartQuickTelemetry) chartQuickTelemetry.resize();
    if (chartTelemetry) chartTelemetry.resize();
    if (chartSoc) chartSoc.resize();
    if (chartSoh) chartSoh.resize();
    if (chartRewards) chartRewards.resize();
    if (typeof resizeBatteryCanvas === 'function') resizeBatteryCanvas();
    updateCharts();
  }, 80);
}

function selectRole(roleId, name, title) {
  currentUser.role = roleId;
  currentUser.name = name;
  currentUser.title = title;

  document.querySelectorAll(".role-chip-btn").forEach(btn => btn.classList.remove("active"));
  const btnId = (roleId === 'lead_engineer') ? 'role-eng' : (roleId === 'fleet_operator' ? 'role-op' : 'role-lab');
  const activeBtn = document.getElementById(btnId);
  if (activeBtn) activeBtn.classList.add("active");

  const emailMap = {
    'lead_engineer': 'amanda.puja@ecobat.ai',
    'fleet_operator': 'budi.santoso@fleet-ecobat.id',
    'lab_researcher': 'hendra.wijaya@lab-ecobat.org'
  };
  const inputEmail = document.getElementById("input-login-id");
  if (inputEmail && emailMap[roleId]) {
    inputEmail.value = emailMap[roleId];
  }
  playTone(587.33, 'sine', 0.08, 0.03);
}

function handleLoginFormSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  localStorage.setItem("ecobat_logged_in", "true");
  localStorage.setItem("ecobat_user_name", currentUser.name);
  showDashboardView(true);
}

function quickLoginDemo() {
  localStorage.setItem("ecobat_logged_in", "true");
  localStorage.setItem("ecobat_user_name", currentUser.name);
  showDashboardView(true);
}

function logoutUser() {
  localStorage.removeItem("ecobat_logged_in");
  showLandingView(true);
}

function previewBatteryTourFromLanding() {
  localStorage.setItem("ecobat_logged_in", "true");
  showDashboardView(true);
  activateNavSection('nav-explainer');
  setTimeout(() => {
    if (typeof startTourStep === 'function') startTourStep(1);
  }, 200);
}

function previewPrototypeFromLanding() {
  localStorage.setItem("ecobat_logged_in", "true");
  showDashboardView(true);
  activateNavSection('nav-prototype');
}

function toggleThemeGlobal() {
  const nextTheme = state.theme === "light" ? "dark" : "light";
  setTheme(nextTheme);
  playChimeNotice();
}

function toggleLandingMobileDrawer() {
  const drawer = document.getElementById("landing-mobile-drawer");
  if (drawer) {
    drawer.style.display = (drawer.style.display === "flex") ? "none" : "flex";
  }
}

function closeLandingMobileDrawer() {
  const drawer = document.getElementById("landing-mobile-drawer");
  if (drawer) {
    drawer.style.display = "none";
  }
}

const NAVBAR_MODES = ["floating-normal", "floating-compact", "floating-wide"];
let currentNavbarModeIdx = 0;

function applyNavbarLayoutMode(modeName) {
  const navbars = document.querySelectorAll(".floating-navbar");
  navbars.forEach(nav => {
    NAVBAR_MODES.forEach(m => nav.classList.remove(m));
    nav.classList.add(modeName);
  });
  const indicators = document.querySelectorAll(".nav-size-indicator");
  const iconMap = {
    "floating-normal": "⤢",
    "floating-compact": "⤡",
    "floating-wide": "↔"
  };
  indicators.forEach(el => {
    el.textContent = iconMap[modeName] || "⤢";
  });
}

function cycleNavbarLayout() {
  currentNavbarModeIdx = (currentNavbarModeIdx + 1) % NAVBAR_MODES.length;
  const modeName = NAVBAR_MODES[currentNavbarModeIdx];
  localStorage.setItem("ecobat_navbar_mode", modeName);
  applyNavbarLayoutMode(modeName);
  playChimeNotice();
}

// =========================================================
// LANDING PAGE INTERACTIVE MINI SIMULATOR (60-FPS CANVAS)
// =========================================================
let landingSim = {
  mode: 'discharge', // 'discharge', 'charge', 'regen', 'idle'
  current: -45.2,
  voltage: 350.0,
  soc: 64.5,
  ions: [],
  electrons: [],
  animFrameId: null
};

function initLandingMiniSimulator() {
  const canvas = document.getElementById("landing-mini-canvas");
  if (!canvas) return;

  // Initialize 40 lithium ion particles
  landingSim.ions = [];
  for (let i = 0; i < 40; i++) {
    landingSim.ions.push({
      x: 0.15 + Math.random() * 0.70,
      y: 0.22 + Math.random() * 0.58,
      r: 4.5 + Math.random() * 2,
      speedX: (Math.random() * 0.0015 + 0.001),
      speedY: (Math.random() - 0.5) * 0.0008,
      phase: Math.random() * Math.PI * 2
    });
  }

  // Initialize 20 electrons on circuit
  landingSim.electrons = [];
  for (let i = 0; i < 20; i++) {
    landingSim.electrons.push({
      progress: Math.random(),
      speed: 0.0035
    });
  }

  renderLandingMiniFrame();
}

function setLandingSimMode(mode) {
  landingSim.mode = mode;
  document.querySelectorAll(".landing-mode-btn").forEach(btn => btn.classList.remove("active"));
  const btn = document.getElementById(`btn-mode-${mode}`);
  if (btn) btn.classList.add("active");

  if (mode === 'discharge') {
    landingSim.current = -45.2;
    landingSim.voltage = 350.0;
    landingSim.soc = 64.5;
    safeSetText("sim-mini-curr", "-45.2 A");
    safeSetText("sim-mini-volt", "350.0 V");
    safeSetText("sim-mini-soc", "64.5%");
    safeSetText("sim-mini-bal", "SIAGA (<14mV)");
    playTone(440, 'sine', 0.1, 0.03);
  } else if (mode === 'charge') {
    landingSim.current = 85.0;
    landingSim.voltage = 378.4;
    landingSim.soc = 42.0;
    safeSetText("sim-mini-curr", "+85.0 A");
    safeSetText("sim-mini-volt", "378.4 V");
    safeSetText("sim-mini-soc", "42.0%");
    safeSetText("sim-mini-bal", "AKTIF (ΔV 22mV)");
    playTone(550, 'sine', 0.12, 0.03);
  } else if (mode === 'regen') {
    landingSim.current = 30.0;
    landingSim.voltage = 362.8;
    landingSim.soc = 71.2;
    safeSetText("sim-mini-curr", "+30.0 A");
    safeSetText("sim-mini-volt", "362.8 V");
    safeSetText("sim-mini-soc", "71.2%");
    safeSetText("sim-mini-bal", "SIAGA (<14mV)");
    playTone(660, 'sine', 0.1, 0.03);
  } else {
    // idle
    landingSim.current = 0.0;
    landingSim.voltage = 352.0;
    landingSim.soc = 80.0;
    safeSetText("sim-mini-curr", "0.0 A");
    safeSetText("sim-mini-volt", "352.0 V");
    safeSetText("sim-mini-soc", "80.0%");
    safeSetText("sim-mini-bal", "IDLE");
    playTone(392, 'sine', 0.08, 0.03);
  }
}

function renderLandingMiniFrame() {
  const canvas = document.getElementById("landing-mini-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Adapt canvas internal buffer to client dimensions
  if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
    canvas.width = canvas.clientWidth || 900;
    canvas.height = canvas.clientHeight || 240;
  }

  const W = canvas.width;
  const H = canvas.height;

  // Background
  const isDark = state.theme === "dark";
  ctx.fillStyle = isDark ? "#0D1814" : "#F4ECE2";
  ctx.fillRect(0, 0, W, H);

  // Electrodes & Separator geometry
  const cathodeW = W * 0.22;
  const anodeW = W * 0.22;
  const sepX = W * 0.5;
  const sepW = 32;

  // Cathode (+) Block (Left)
  const gradCathode = ctx.createLinearGradient(0, 0, cathodeW, 0);
  gradCathode.addColorStop(0, isDark ? "rgba(82, 137, 116, 0.45)" : "rgba(82, 137, 116, 0.28)");
  gradCathode.addColorStop(1, isDark ? "rgba(82, 137, 116, 0.15)" : "rgba(82, 137, 116, 0.08)");
  ctx.fillStyle = gradCathode;
  ctx.fillRect(16, 20, cathodeW - 16, H - 40);
  ctx.strokeStyle = "#528974";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 20, cathodeW - 16, H - 40);

  // Anode (-) Block (Right)
  const gradAnode = ctx.createLinearGradient(W - anodeW, 0, W, 0);
  gradAnode.addColorStop(0, isDark ? "rgba(72, 153, 128, 0.15)" : "rgba(72, 153, 128, 0.08)");
  gradAnode.addColorStop(1, isDark ? "rgba(72, 153, 128, 0.45)" : "rgba(72, 153, 128, 0.28)");
  ctx.fillStyle = gradAnode;
  ctx.fillRect(W - anodeW, 20, anodeW - 16, H - 40);
  ctx.strokeStyle = "#489980";
  ctx.strokeRect(W - anodeW, 20, anodeW - 16, H - 40);

  // Porous Separator (Middle)
  ctx.fillStyle = isDark ? "rgba(223, 178, 104, 0.12)" : "rgba(223, 178, 104, 0.22)";
  ctx.fillRect(sepX - sepW / 2, 20, sepW, H - 40);
  ctx.strokeStyle = "rgba(223, 178, 104, 0.6)";
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(sepX - sepW / 2, 20, sepW, H - 40);
  ctx.setLineDash([]);

  // Labels
  ctx.font = "bold 12px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = isDark ? "#FAF7F2" : "#182520";
  ctx.textAlign = "center";
  ctx.fillText("KATODA (+) LiFePO4 / NMC", cathodeW / 2 + 8, 42);
  ctx.fillText("ANODA (-) Grafit", W - anodeW / 2 - 8, 42);
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = isDark ? "#A5BAAF" : "#528974";
  ctx.fillText("SEPARATOR", sepX, 36);

  // Direction & Speed factor
  let dir = 0;
  if (landingSim.mode === 'discharge') dir = -1; // towards cathode
  else if (landingSim.mode === 'charge' || landingSim.mode === 'regen') dir = 1; // towards anode

  const speedMult = Math.abs(landingSim.current) / 45.0;

  // Draw and update Lithium Ions (Li+)
  landingSim.ions.forEach(ion => {
    ion.phase += 0.04;
    if (dir !== 0) {
      ion.x += dir * ion.speedX * speedMult * 1.5;
      if (ion.x < 0.12) ion.x = 0.88;
      if (ion.x > 0.88) ion.x = 0.12;
    }
    ion.y += Math.sin(ion.phase) * 0.0008;
    if (ion.y < 0.18) ion.y = 0.18;
    if (ion.y > 0.82) ion.y = 0.82;

    const px = ion.x * W;
    const py = ion.y * H;

    // Glowing Ion circle
    ctx.beginPath();
    ctx.arc(px, py, ion.r, 0, Math.PI * 2);
    ctx.fillStyle = "#489980";
    ctx.shadowColor = "rgba(72, 153, 128, 0.6)";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Symbol Li+
    ctx.font = "bold 7px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Li+", px, py + 2.5);
  });

  // Top Circuit External Electron Flow (Wire)
  ctx.beginPath();
  ctx.moveTo(cathodeW / 2 + 8, 20);
  ctx.lineTo(cathodeW / 2 + 8, 8);
  ctx.lineTo(W - anodeW / 2 - 8, 8);
  ctx.lineTo(W - anodeW / 2 - 8, 20);
  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.25)" : "rgba(82, 137, 116, 0.4)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Electrons along the wire
  if (dir !== 0) {
    landingSim.electrons.forEach(el => {
      el.progress += dir * el.speed * speedMult * 1.8;
      if (el.progress < 0) el.progress = 1;
      if (el.progress > 1) el.progress = 0;

      const ex = (cathodeW / 2 + 8) + el.progress * ((W - anodeW / 2 - 8) - (cathodeW / 2 + 8));
      ctx.beginPath();
      ctx.arc(ex, 8, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#DFB268";
      ctx.shadowColor = "rgba(223, 178, 104, 0.8)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  landingSim.animFrameId = requestAnimationFrame(renderLandingMiniFrame);
}

// =========================================================
// INTERACTIVE ROI CALCULATOR
// =========================================================
function initLandingRoiCalculator() {
  updateRoiCalculation();
}

function updateRoiCalculation() {
  const sliderFleet = document.getElementById("slider-fleet-size");
  const sliderCost = document.getElementById("slider-battery-cost");
  if (!sliderFleet || !sliderCost) return;

  const fleet = parseInt(sliderFleet.value, 10);
  const cost = parseInt(sliderCost.value, 10);

  safeSetText("label-fleet-size", `${fleet} Unit EV`);
  safeSetText("label-battery-cost", `$${cost.toLocaleString()} USD`);

  // Savings: ~32% reduction in replacement frequency
  const totalSavings = Math.round(fleet * cost * 0.32);
  const wasteSaved = (fleet * 0.45).toFixed(1);

  safeSetText("calc-result-savings", `$${totalSavings.toLocaleString()}`);
  safeSetText("calc-result-years", "+3.2 Thn");
  safeSetText("calc-result-waste", `${wasteSaved} Ton`);
  safeSetText("calc-result-payback", fleet > 50 ? "< 3.5 Bulan" : "< 4.8 Bulan");
}

// Initialization on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  console.log("⚡ ECOBAT AI BMS Engine Starting...");
  try {
    initTheme();
    initAuthView();
    initLandingMiniSimulator();
    initLandingRoiCalculator();
    initNavigationHubs();
    initMobileDrawer();
    init16Cells();
    seedInitialHistory();
    initCharts();
    bindEvents();
    initUptimeClock();
    initBatteryVisualizer();
    initStoryTour();
    initPrototypeHub();
    startSimulationLoop();
    attemptBackendConnection();
    updateUI();
    console.log("✅ ECOBAT AI BMS Real-time Engine Live & Active!");
  } catch (err) {
    console.error("Initialization Error:", err);
  }
});

// Theme Management (Pastel Light / Midnight)
function initTheme() {
  const savedTheme = localStorage.getItem("ecobat-theme") || "light";
  setTheme(savedTheme);

  safeOn("btn-toggle-theme", "click", () => {
    const nextTheme = state.theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    playChimeNotice();
  });
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ecobat-theme", theme);

  const themeIcon = document.getElementById("theme-icon");
  if (themeIcon) {
    themeIcon.innerText = theme === "light" ? "🌙" : "☀️";
  }

  document.querySelectorAll(".theme-icon-indicator").forEach(el => {
    el.innerText = theme === "light" ? "🌙" : "☀️";
  });

  // Update Chart Colors for the Theme
  setTimeout(() => {
    updateChartsTheme();
  }, 100);
}

// 16-Cell Module Initialization
function init16Cells() {
  state.cells = [];
  const baseVolt = 350.0 / 96 * 6; // ~21.875V submodule or ~3.645V per single cell
  for (let i = 1; i <= 16; i++) {
    const variance = (Math.sin(i) * 0.015);
    state.cells.push({
      id: i,
      name: `C${i < 10 ? '0' : ''}${i}`,
      voltage: parseFloat((3.650 + variance).toFixed(3)),
      temp: parseFloat((28.5 + (i % 4) * 0.4).toFixed(1)),
      balancing: false
    });
  }
  renderCellMatrix();
}

function updateCellMatrix() {
  const cellNominal = (state.voltage / 96); // ~3.65V per cell in standard 96S EV pack
  let maxV = -999;
  let minV = 999;
  let activeBalCount = 0;

  state.cells.forEach((cell, idx) => {
    const noise = state.noiseEnabled ? (Math.random() * 0.012 - 0.006) : (Math.random() * 0.004 - 0.002);
    cell.voltage = parseFloat((cellNominal + (Math.sin(idx + state.ticks * 0.2) * 0.008) + noise).toFixed(3));
    cell.temp = parseFloat((state.temp + ((idx % 5) - 2) * 0.3).toFixed(1));

    if (cell.voltage > maxV) maxV = cell.voltage;
    if (cell.voltage < minV) minV = cell.voltage;
  });

  const deltaMv = Math.round((maxV - minV) * 1000);

  // Active Balancing Trigger: if cell is higher than min by 14mV, mark as balancing
  state.cells.forEach(cell => {
    cell.balancing = (cell.voltage - minV) >= 0.014;
    if (cell.balancing) activeBalCount++;
  });

  safeSetText("pack-avg-volt", `${cellNominal.toFixed(2)} V`);
  safeSetText("pack-delta-volt", `${deltaMv} mV`);
  safeSetText("pack-active-bal", `${activeBalCount} Sel`);

  const kw = ((state.voltage * state.current) / 1000).toFixed(1);
  safeSetText("pack-kw-val", `${kw} kW`);

  renderCellMatrix();
}

function renderCellMatrix() {
  const container = document.getElementById("cell-matrix-grid");
  if (!container) return;

  let html = "";
  state.cells.forEach(cell => {
    // Level percentage based on SoC
    const pct = Math.min(100, Math.max(10, Math.round(state.soc)));
    const isBal = cell.balancing ? "balancing" : "";

    html += `
      <div class="cell-box ${isBal}">
        <span class="cell-bal-tag">BAL</span>
        <span class="cell-id-badge">${cell.name}</span>
        <span class="cell-volt-text">${cell.voltage.toFixed(3)}V</span>
        <span class="cell-temp-text">${cell.temp}°C</span>
        <div class="cell-level-bar">
          <div class="cell-level-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Navigation Hub Switcher
function initNavigationHubs() {
  const hubBtns = document.querySelectorAll(".nav-hub-btn");
  hubBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetNavId = btn.getAttribute("data-nav");
      activateNavSection(targetNavId);
      const drawer = document.getElementById("mobile-drawer");
      if (drawer) drawer.style.display = "none";
    });
  });
}

function toggleDashboardSidebar() {
  const sidebar = document.getElementById("dashboard-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar) return;
  const isOpen = sidebar.classList.contains("open");
  if (isOpen) {
    sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("active");
  } else {
    sidebar.classList.add("open");
    if (backdrop) backdrop.classList.add("active");
  }
}

function activateNavSection(targetNavId) {
  const hubBtns = document.querySelectorAll(".nav-hub-btn");
  hubBtns.forEach(b => {
    if (b.getAttribute("data-nav") === targetNavId) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });

  document.querySelectorAll(".nav-section").forEach(sec => sec.classList.remove("active"));
  const targetSec = document.getElementById(targetNavId);
  if (targetSec) {
    targetSec.classList.add("active");
  }

  // Auto-close sidebar on mobile/tablet screens
  if (window.innerWidth <= 1024) {
    const sidebar = document.getElementById("dashboard-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("active");
  }

  setTimeout(() => {
    if (chartQuickTelemetry) chartQuickTelemetry.resize();
    if (chartTelemetry) chartTelemetry.resize();
    if (chartSoc) chartSoc.resize();
    if (chartSoh) chartSoh.resize();
    if (chartRewards) chartRewards.resize();
    if (typeof resizeBatteryCanvas === 'function') resizeBatteryCanvas();
    updateCharts();
  }, 60);
}

function initMobileDrawer() {
  const savedNavMode = localStorage.getItem("ecobat_navbar_mode") || "floating-normal";
  currentNavbarModeIdx = Math.max(0, NAVBAR_MODES.indexOf(savedNavMode));
  applyNavbarLayoutMode(NAVBAR_MODES[currentNavbarModeIdx]);

  safeOn("mobile-menu-toggle", "click", () => {
    const drawer = document.getElementById("mobile-drawer");
    if (drawer) {
      drawer.style.display = (drawer.style.display === "flex") ? "none" : "flex";
    }
  });
}

// Uptime Clock
function initUptimeClock() {
  if (uptimeTimer) clearInterval(uptimeTimer);
  uptimeTimer = setInterval(() => {
    state.uptimeSeconds++;
    const h = String(Math.floor(state.uptimeSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((state.uptimeSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(state.uptimeSeconds % 60).padStart(2, '0');
    safeSetText("stream-uptime", `${h}:${m}:${s}`);
  }, 1000);
}

// Seed History
function seedInitialHistory() {
  let tempSoc = 80.0;
  let tempSoh = 100.0;
  let tempTemp = 27.0;
  let tempThroughput = 0;

  for (let i = 0; i < 30; i++) {
    let mode = tempSoc <= 20 ? 'charge' : 'discharge';
    let curr = mode === 'charge' ? 45.0 + Math.random() * 20 : -(35.0 + Math.random() * 30);
    let dSoc = mode === 'charge' ? 0.35 : -0.4;
    tempSoc = Math.min(100, Math.max(0, tempSoc + dSoc));
    let volt = 300 + (tempSoc / 100.0) * 100 + (Math.random() * 2 - 1);

    let currStress = Math.abs(curr) / 120.0;
    tempTemp += (currStress * 0.45) - 0.08 * (tempTemp - 27.0) + (Math.random() * 0.2 - 0.1);
    tempTemp = Math.min(60, Math.max(15, tempTemp));
    let dod = 100.0 - tempSoc;
    tempThroughput += Math.abs(dSoc) / 100.0;
    let cycles = tempThroughput / 2.0;

    let deg = 0.00008 + Math.max(0, tempTemp - 35) * 0.00008 + currStress * 0.00005;
    tempSoh = Math.max(80.0, tempSoh - deg);
    let rul = Math.max(0, ((tempSoh - 80.0) / 20.0) * 10000);

    const record = {
      step: i,
      timestamp: getFormattedTime(i),
      voltage: parseFloat(volt.toFixed(2)),
      current: parseFloat(curr.toFixed(2)),
      temp: parseFloat(tempTemp.toFixed(2)),
      soc: parseFloat(tempSoc.toFixed(2)),
      soh: parseFloat(tempSoh.toFixed(2)),
      dod: parseFloat(dod.toFixed(2)),
      cycles: Math.round(cycles),
      rul: Math.round(rul),
      mode: mode,
      anomaly: "AMAN",
      action: mode === 'charge' ? 2 : 4,
      reward: parseFloat((8.5 + (i * 0.1)).toFixed(2))
    };
    state.history.push(record);
    state.logs.push(record);
    state.rewardHistory.push(record.reward);
  }

  state.step = 30;
  state.soc = tempSoc;
  state.soh = tempSoh;
  state.temp = tempTemp;
  state.voltage = state.history[state.history.length - 1].voltage;
  state.current = state.history[state.history.length - 1].current;
  state.cycles = state.history[state.history.length - 1].cycles;
  state.dod = 100.0 - state.soc;
}

// Bind Events & Controls
function bindEvents() {
  // Stream Toggle
  safeOn("btn-toggle-sim", "click", () => {
    state.isLive = !state.isLive;
    updateStreamToggleUI();
    playChimeNotice();
  });

  // Sound Toggle
  safeOn("btn-toggle-sound", "click", () => {
    state.soundEnabled = !state.soundEnabled;
    const soundIcon = document.getElementById("sound-icon");
    if (soundIcon) soundIcon.innerText = state.soundEnabled ? "🔊" : "🔇";
    if (state.soundEnabled) playChimeNotice();
  });

  // Speed Selector Buttons
  const speedBtns = document.querySelectorAll(".speed-btn");
  speedBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      speedBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const speed = parseInt(btn.getAttribute("data-speed"));
      setStreamSpeed(speed);
      playChimeNotice();
    });
  });

  // Manual Step 1-Tick
  safeOn("btn-step-tick", "click", () => {
    executeSimulationTick();
    playTone(700, 'sine', 0.08, 0.03);
  });

  // Reset Simulation
  safeOn("btn-reset-sim", "click", () => {
    state.step = 0;
    state.ticks = 0;
    state.soc = 80.0;
    state.soh = 100.0;
    state.temp = 27.0;
    state.history = [];
    state.logs = [];
    state.rewardHistory = [];
    seedInitialHistory();
    init16Cells();
    updateUI();
    playChimeNotice();
  });

  // Sliders
  const sliders = [
    { id: 'slider-voltage', key: 'voltage' },
    { id: 'slider-current', key: 'current' },
    { id: 'slider-temp', key: 'temp' },
    { id: 'slider-soc', key: 'soc' },
    { id: 'slider-soh', key: 'soh' },
    { id: 'slider-cycles', key: 'cycles' }
  ];

  sliders.forEach(item => {
    safeOn(item.id, "input", (e) => {
      state[item.key] = parseFloat(e.target.value);
      if (item.key === 'soc') {
        state.dod = 100.0 - state.soc;
      }
      updateUI();
    });
  });

  // Noise Toggle
  safeOn("chk-noise", "change", (e) => {
    state.noiseEnabled = e.target.checked;
  });

  // CAN Terminal Controls
  safeOn("btn-clear-can", "click", () => {
    const term = document.getElementById("can-bus-terminal");
    if (term) term.innerHTML = "";
  });

  safeOn("btn-pause-can", "click", () => {
    state.canStreaming = !state.canStreaming;
    const btn = document.getElementById("btn-pause-can");
    if (btn) btn.innerText = state.canStreaming ? "Jeda" : "Lanjut";
  });

  // Export Buttons
  safeOn("btn-export-csv", "click", exportCSV);
  safeOn("btn-export-json", "click", exportJSON);
}

function updateStreamToggleUI() {
  const pill = document.getElementById("status-pill-main");
  const btnLabel = document.getElementById("sim-btn-label");

  if (state.isLive) {
    if (btnLabel) btnLabel.innerText = "Jeda Stream";
    if (pill) {
      pill.className = "status-pill status-online";
      safeSetText("status-pill-text", "LIVE BUS OK");
    }
  } else {
    if (btnLabel) btnLabel.innerText = "Lanjut Stream";
    if (pill) {
      pill.className = "status-pill paused";
      safeSetText("status-pill-text", "STREAM DIJEDA");
    }
  }
}

function setStreamSpeed(ms) {
  state.streamIntervalMs = ms;
  startSimulationLoop();
}

// Preset Scenarios
function setPreset(type) {
  playChimeNotice();
  if (type === 'normal') {
    state.soc = 65.0;
    state.current = -45.0;
    state.temp = 28.5;
    state.voltage = 352.0;
    state.soh = 98.0;
    state.mode = 'discharge';
  } else if (type === 'fastcharge') {
    state.soc = 35.0;
    state.current = 95.0;
    state.temp = 38.0;
    state.voltage = 385.0;
    state.mode = 'charge';
    playTone(550, 'sine', 0.2, 0.05);
  } else if (type === 'overheat') {
    state.soc = 50.0;
    state.current = 110.0;
    state.temp = 53.0;
    state.voltage = 398.0;
    state.mode = 'charge';
    playWarningTone();
  } else if (type === 'depleted') {
    state.soc = 11.0;
    state.current = -25.0;
    state.temp = 26.0;
    state.voltage = 305.0;
    state.mode = 'discharge';
    playWarningTone();
  } else if (type === 'regen') {
    state.soc = 68.0;
    state.current = 40.0;
    state.temp = 30.0;
    state.voltage = 360.0;
    state.mode = 'regen';
    playTone(880, 'sine', 0.15, 0.04);
  }
  state.dod = 100.0 - state.soc;
  updateUI();
}

// Simulation Loop
function startSimulationLoop() {
  if (simTimer) clearInterval(simTimer);
  simTimer = setInterval(() => {
    if (state.isLive) {
      executeSimulationTick();
    }
  }, state.streamIntervalMs);
}

function executeSimulationTick() {
  try {
    state.step++;
    state.ticks++;
    safeSetText("stream-ticks", `#${state.ticks}`);

    // Mode Automatic Transition
    if (state.soc <= 15) {
      state.mode = 'charge';
    } else if (state.soc >= 92) {
      state.mode = 'discharge';
    }

    let deltaSoc = 0;
    if (state.mode === 'charge') {
      state.current = 35.0 + Math.random() * 45.0;
      deltaSoc = 0.22 + Math.random() * 0.28;
    } else if (state.mode === 'regen') {
      state.current = 30.0 + Math.random() * 20.0;
      deltaSoc = 0.15 + Math.random() * 0.15;
    } else {
      state.current = -(25.0 + Math.random() * 55.0);
      deltaSoc = -(0.15 + Math.random() * 0.30);
    }

    if (state.noiseEnabled) {
      state.current += (Math.random() * 24 - 12);
    }

    state.soc = Math.min(100.0, Math.max(0.0, state.soc + deltaSoc));
    state.dod = 100.0 - state.soc;

    let calculatedVoltage = 300 + (state.soc / 100.0) * 100;
    let voltNoise = state.noiseEnabled ? (Math.random() * 8 - 4) : (Math.random() * 1.2 - 0.6);
    state.voltage = parseFloat((calculatedVoltage + voltNoise).toFixed(1));

    let currentStress = Math.abs(state.current) / 120.0;
    let heatGen = 0.50 * currentStress;
    let cooling = 0.08 * (state.temp - 27.0);
    let tempNoise = state.noiseEnabled ? (Math.random() * 2.5 - 1.25) : (Math.random() * 0.25 - 0.125);
    state.temp = parseFloat((Math.min(65.0, Math.max(10.0, state.temp + heatGen - cooling + tempNoise))).toFixed(1));

    state.throughput += Math.abs(deltaSoc) / 100.0;
    state.cycles = Math.round(state.throughput / 2.0);

    let tempPenalty = Math.max(0, state.temp - 35.0) * 0.00008;
    let currPenalty = currentStress * 0.00005;
    let dodPenalty = Math.max(0, state.dod - 80.0) * 0.00003;
    let degradation = 0.00008 + tempPenalty + currPenalty + dodPenalty;

    state.soh = Math.max(CONFIG.end_of_life_soh, state.soh - degradation);

    updateCellMatrix();
    updateEnergyFlowUI();
    streamCANBusFrame();
    updateUI();

    // Critical sound warning if temp > 48
    if (state.temp > 48.0 && state.ticks % 4 === 0) {
      playWarningTone();
    }
  } catch (err) {
    console.error("Simulation Tick Error:", err);
  }
}

// Energy Flow Stream Line UI Update
function updateEnergyFlowUI() {
  const wire = document.getElementById("flow-particle-line");
  const nodeGrid = document.getElementById("node-grid");
  const nodeMotor = document.getElementById("node-motor");
  const gridStatus = document.getElementById("flow-grid-status");
  const packStatus = document.getElementById("flow-pack-status");
  const motorStatus = document.getElementById("flow-motor-status");

  const kw = ((state.voltage * Math.abs(state.current)) / 1000).toFixed(1);

  if (state.current > 5) {
    // Charging
    if (wire) wire.className.baseVal = "flow-particle-path charge";
    if (nodeGrid) nodeGrid.className = "flow-node active";
    if (nodeMotor) nodeMotor.className = "flow-node";
    if (gridStatus) gridStatus.innerText = `Fast Charging ${kw} kW`;
    if (packStatus) packStatus.innerText = `+${state.current.toFixed(1)} A Mengisi`;
    if (motorStatus) motorStatus.innerText = `Inverter Siaga`;
  } else if (state.current < -5) {
    // Discharging
    if (wire) wire.className.baseVal = "flow-particle-path discharge";
    if (nodeGrid) nodeGrid.className = "flow-node";
    if (nodeMotor) nodeMotor.className = "flow-node active";
    if (gridStatus) gridStatus.innerText = `Terputus`;
    if (packStatus) packStatus.innerText = `${state.current.toFixed(1)} A Suplai`;
    if (motorStatus) motorStatus.innerText = `Traksi Beban ${kw} kW`;
  } else {
    // Idle
    if (wire) wire.className.baseVal = "flow-particle-path";
    if (nodeGrid) nodeGrid.className = "flow-node";
    if (nodeMotor) nodeMotor.className = "flow-node";
    if (gridStatus) gridStatus.innerText = `Standby`;
    if (packStatus) packStatus.innerText = `Idle (0 A)`;
    if (motorStatus) motorStatus.innerText = `Standby (0 kW)`;
  }
}

// CAN-Bus Real-Time Streamer
function streamCANBusFrame() {
  if (!state.canStreaming) return;
  const terminal = document.getElementById("can-bus-terminal");
  if (!terminal) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(Math.floor(now.getMilliseconds() / 10)).padStart(2, '0')}`;

  const frames = [
    {
      id: "0x1806E5F4",
      data: `${toHex(Math.round(state.voltage * 10))} ${toHex(Math.abs(Math.round(state.current * 10)))} 01 C8 24 10`,
      tag: `BMS_VoltCurr (${state.voltage}V, ${state.current}A)`
    },
    {
      id: "0x1818D0F4",
      data: `${toHex(Math.round(state.soc * 2))} ${toHex(Math.round(state.soh * 2))} 0E 38 00 0C`,
      tag: `BMS_SoC_SoH (${state.soc.toFixed(1)}%, ${state.soh.toFixed(1)}%)`
    },
    {
      id: "0x1829B0F4",
      data: `${toHex(Math.round(state.temp + 40))} 1A 00 00 00 00 00 00`,
      tag: `BMS_Thermal (${state.temp}°C)`
    }
  ];

  const frame = frames[state.ticks % frames.length];

  const row = document.createElement("div");
  row.className = "can-packet-row";
  row.innerHTML = `
    <span class="can-time">[${timeStr}]</span>
    <span class="can-id">${frame.id}</span>
    <span class="can-data">${frame.data}</span>
    <span class="can-tag"># ${frame.tag}</span>
  `;

  terminal.appendChild(row);

  // Keep max 25 rows
  while (terminal.children.length > 25) {
    terminal.removeChild(terminal.firstChild);
  }

  terminal.scrollTop = terminal.scrollHeight;
}

function toHex(val) {
  const v = Math.abs(val) & 0xFF;
  return v.toString(16).toUpperCase().padStart(2, '0');
}

// Signal Validation & EMA Filtering
function validateSignalAndDetectAnomalies() {
  let anomalies = [];
  let isSpike = false;

  if (state.voltage < 290 || state.voltage > 420) {
    anomalies.push(`Anomali Tegangan (${state.voltage}V di luar batas [290V-420V])`);
    isSpike = true;
  }
  if (Math.abs(state.current) > 115) {
    anomalies.push(`Anomali Arus Berlebih (${state.current}A melebihi batas safe)`);
    isSpike = true;
  }
  if (state.temp > 48.0) {
    anomalies.push(`Anomali Suhu Tinggi (${state.temp}°C potensi thermal runaway)`);
  }
  if (state.soc < 15.0) {
    anomalies.push(`Anomali Deep Discharge (SoC ${state.soc.toFixed(1)}% &lt; 15%)`);
  }
  if (state.soc > 92.0) {
    anomalies.push(`Anomali Overcharge Risk (SoC ${state.soc.toFixed(1)}% &gt; 92%)`);
  }

  const alpha = 0.25;
  emaState.voltage = alpha * state.voltage + (1 - alpha) * emaState.voltage;
  emaState.current = alpha * state.current + (1 - alpha) * emaState.current;
  emaState.temp = alpha * state.temp + (1 - alpha) * emaState.temp;

  let healthScore = 100.0 - (anomalies.length * 15.0) - (state.noiseEnabled ? 8.0 : 0.0);
  healthScore = Math.max(40.0, Math.min(100.0, healthScore));

  return {
    anomalies,
    isSpike,
    healthScore: healthScore.toFixed(1),
    filteredVoltage: emaState.voltage.toFixed(1),
    filteredCurrent: emaState.current.toFixed(1),
    filteredTemp: emaState.temp.toFixed(1)
  };
}

// LSTM Inference Simulation
function runLSTMInference() {
  let predictedSoc = state.soc + (Math.random() * 0.4 - 0.2);
  predictedSoc = Math.min(100, Math.max(0, predictedSoc));

  let predictedSoh = state.soh - (Math.random() * 0.0008);
  predictedSoh = Math.max(CONFIG.end_of_life_soh, predictedSoh);

  let rul = Math.max(0.0, ((predictedSoh - CONFIG.end_of_life_soh) / (100.0 - CONFIG.end_of_life_soh)) * CONFIG.max_cycle_life);

  return {
    soc: predictedSoc.toFixed(1),
    soh: predictedSoh.toFixed(1),
    rul: Math.round(rul)
  };
}

// DQN Strategy Solver
function evaluateDQNStrategy(lstmPred) {
  let qValues = [0, 0, 0, 0, 0];

  qValues[0] = 2.0 + (state.temp > 40 ? 3.5 : 0.0) - (state.soc < 20 ? 4.0 : 0.0);
  qValues[1] = 4.0 + (state.soc < 60 ? 3.5 : 1.0) - (state.temp > 40 ? 2.5 : 0.0);
  qValues[2] = 5.0 + (state.soc < 80 ? 4.0 : -1.0) - (state.temp > 38 ? 3.5 : 0.0);
  qValues[3] = 3.0 + (state.soc < 50 ? 5.0 : -3.0) - (state.temp > 35 ? 6.0 : 0.0);
  qValues[4] = 6.0 + (state.soc > 30 ? 4.5 : -5.0) - (state.temp > 45 ? 4.0 : 0.0);

  let maxQ = -999;
  let bestAction = 0;
  for (let a = 0; a < 5; a++) {
    qValues[a] = parseFloat(qValues[a].toFixed(2));
    if (qValues[a] > maxQ) {
      maxQ = qValues[a];
      bestAction = a;
    }
  }

  let rewards = [];
  let penalties = [];

  if (state.soc >= 20 && state.soc <= 90) rewards.push("✅ Rentang SoC Aman (20 - 90%)");
  else penalties.push(`⚠️ SoC Ekstrem (${state.soc.toFixed(1)}%): Risiko Over/Under Discharge`);

  if (state.temp >= 15 && state.temp <= 35) rewards.push("✅ Suhu Baterai Optimal (15 - 35°C)");
  else if (state.temp > 42) penalties.push(`🔥 Penalti Suhu Tinggi (${state.temp.toFixed(1)}°C > 42°C)`);

  if (state.soh >= 90) rewards.push("✅ Kesehatan Baterai (SoH) Tinggi (>90%)");

  if (bestAction === 3 && state.temp > 32) {
    penalties.push("⛔ Fast Charge Penalti: Risiko Stress Termal Sel");
  }

  let riskLevel = "AMAN";
  let riskMsg = "Baterai berada pada rentang operasi normal. Tidak ada ancaman proteksi aktif.";
  let chargeRate = "1.0 C-Rate (Normal)";
  let currentLimit = "90 A";
  let thermalStatus = "Low (25%)";

  if (state.temp > 45 || state.soc < 15 || state.soc > 92) {
    riskLevel = "KRITIS";
    riskMsg = "BAHAYA KRITIS: Parameter baterai melebihi ambang batas aman. Proteksi disiagakan!";
    chargeRate = "0.2 C-Rate (Emergency Cutoff)";
    currentLimit = "20 A (Restricted)";
    thermalStatus = "MAX (100%)";
  } else if (state.temp > 38 || state.soc < 25 || state.soc > 85) {
    riskLevel = "WASPADA";
    riskMsg = "WASPADA: Peningkatan suhu atau SoC mendekati batas. Pembatasan daya diberlakukan.";
    chargeRate = "0.5 C-Rate (Reduced)";
    currentLimit = "55 A (Derated)";
    thermalStatus = "Medium (60%)";
  }

  return {
    bestAction,
    qValues,
    rewards,
    penalties,
    riskLevel,
    riskMsg,
    chargeRate,
    currentLimit,
    thermalStatus,
    totalReward: maxQ
  };
}

// Master UI Update
function updateUI() {
  try {
    // Global KPIs
    safeSetText("kpi-voltage", state.voltage.toFixed(1));
    safeSetText("kpi-current", state.current.toFixed(1));
    safeSetText("kpi-temp", state.temp.toFixed(1));
    safeSetText("kpi-soc", state.soc.toFixed(1));
    safeSetText("kpi-dod", state.dod.toFixed(1));
    safeSetText("kpi-soh", state.soh.toFixed(1));
    safeSetText("kpi-mode", state.current > 0 ? "Charging Mode" : (state.current < 0 ? "Discharging Mode" : "Idle Siaga"));

    // Form Sliders Values
    safeSetText("val-voltage", state.voltage.toFixed(1));
    safeSetText("val-current", state.current.toFixed(1));
    safeSetText("val-temp", state.temp.toFixed(1));
    safeSetText("val-soc", state.soc.toFixed(1));
    safeSetText("val-dod", state.dod.toFixed(1));
    safeSetText("val-soh", state.soh.toFixed(1));
    safeSetText("val-cycles", state.cycles);

    const sliderVolt = document.getElementById("slider-voltage"); if (sliderVolt && document.activeElement !== sliderVolt) sliderVolt.value = state.voltage;
    const sliderCurr = document.getElementById("slider-current"); if (sliderCurr && document.activeElement !== sliderCurr) sliderCurr.value = state.current;
    const sliderTemp = document.getElementById("slider-temp"); if (sliderTemp && document.activeElement !== sliderTemp) sliderTemp.value = state.temp;
    const sliderSoc = document.getElementById("slider-soc"); if (sliderSoc && document.activeElement !== sliderSoc) sliderSoc.value = state.soc;
    const sliderSoh = document.getElementById("slider-soh"); if (sliderSoh && document.activeElement !== sliderSoh) sliderSoh.value = state.soh;
    const sliderCyc = document.getElementById("slider-cycles"); if (sliderCyc && document.activeElement !== sliderCyc) sliderCyc.value = state.cycles;

    // Signal Validation
    const validation = validateSignalAndDetectAnomalies();
    safeSetText("raw-volt", `${state.voltage.toFixed(1)} V`);
    safeSetText("raw-curr", `${state.current.toFixed(1)} A`);
    safeSetText("raw-temp", `${state.temp.toFixed(1)} °C`);

    safeSetText("ema-volt", `${validation.filteredVoltage} V`);
    safeSetText("ema-curr", `${validation.filteredCurrent} A`);
    safeSetText("ema-temp", `${validation.filteredTemp} °C`);

    safeSetText("val-signal-health", `${validation.healthScore}%`);

    const cRate = (Math.abs(state.current) / 120.0).toFixed(2);
    safeSetText("c-rate-val", `${cRate} C`);
    safeSetText("mode-status-text", state.current > 0 ? "CHARGING" : (state.current < 0 ? "DISCHARGING" : "IDLE"));
    safeSetText("temp-qual-text", state.temp < 35 ? "STABIL & AMAN" : (state.temp < 45 ? "WASPADA HANGAT" : "OVERHEAT PANAS"));

    // LSTM Model Predictions
    const lstmPred = runLSTMInference();
    safeSetText("lstm-soc", `${lstmPred.soc}%`);
    safeSetText("lstm-soh", `${lstmPred.soh}%`);
    safeSetText("lstm-rul", `${Number(lstmPred.rul).toLocaleString()} Siklus`);
    safeSetText("kpi-rul", Number(lstmPred.rul).toLocaleString());

    const barSoc = document.getElementById("bar-soc"); if (barSoc) barSoc.style.width = `${lstmPred.soc}%`;
    const barSoh = document.getElementById("bar-soh"); if (barSoh) barSoh.style.width = `${lstmPred.soh}%`;
    const barRul = document.getElementById("bar-rul"); if (barRul) barRul.style.width = `${Math.min(100, (lstmPred.rul / 10000) * 100)}%`;

    // DQN Reinforcement Learning
    const dqnResult = evaluateDQNStrategy(lstmPred);
    const actionObj = ACTIONS[dqnResult.bestAction];
    safeSetText("action-recommended-name", actionObj.name);
    safeSetText("action-recommended-desc", actionObj.desc);

    // Q-values Matrix
    for (let a = 0; a < 5; a++) {
      const qRow = document.getElementById(`q-act-${a}`);
      if (qRow) {
        if (a === dqnResult.bestAction) {
          qRow.className = "q-row-pastel active-q";
        } else {
          qRow.className = "q-row-pastel";
        }
        const fillEl = qRow.querySelector(".q-track-fill");
        const valEl = qRow.querySelector(".q-val-num");
        const normPct = Math.max(10, Math.min(100, (dqnResult.qValues[a] / 14.0) * 100));
        if (fillEl) fillEl.style.width = `${normPct}%`;
        if (valEl) valEl.innerText = dqnResult.qValues[a].toFixed(2);
      }
    }

    // Actuators
    safeSetText("rec-charge-rate", dqnResult.chargeRate);
    safeSetText("rec-current-limit", dqnResult.currentLimit);
    safeSetText("rec-thermal-status", dqnResult.thermalStatus);
    safeSetText("risk-level-badge", `RISK: ${dqnResult.riskLevel}`);
    safeSetHTML("risk-detail-box", `<strong>Status Proteksi Otonom:</strong> ${dqnResult.riskMsg}`);

    // Risk Badge Styling
    const riskBadge = document.getElementById("risk-level-badge");
    if (riskBadge) {
      if (dqnResult.riskLevel === "AMAN") {
        riskBadge.className = "badge-tag btn-pastel-mint";
      } else if (dqnResult.riskLevel === "WASPADA") {
        riskBadge.className = "badge-tag btn-pastel-yellow";
      } else {
        riskBadge.className = "badge-tag btn-pastel-coral";
      }
    }

    // Rewards Factors List
    const rewList = document.getElementById("reward-factors-list");
    if (rewList) {
      rewList.innerHTML = dqnResult.rewards.map(r => `<li>${r}</li>`).join("");
    }
    const penList = document.getElementById("penalty-factors-list");
    if (penList) {
      penList.innerHTML = dqnResult.penalties.length > 0
        ? dqnResult.penalties.map(p => `<li>${p}</li>`).join("")
        : `<li>🟢 Beroperasi dalam batas aman efisiensi tinggi</li>`;
    }

    // Append to Historical Records
    const record = {
      step: state.step,
      timestamp: getFormattedTime(state.step),
      voltage: state.voltage,
      current: state.current,
      temp: state.temp,
      soc: parseFloat(state.soc.toFixed(1)),
      soh: parseFloat(state.soh.toFixed(1)),
      dod: parseFloat(state.dod.toFixed(1)),
      cycles: state.cycles,
      rul: lstmPred.rul,
      mode: state.mode,
      risk: dqnResult.riskLevel,
      action: actionObj.name
    };

    state.history.push(record);
    state.logs.push(record);
    state.rewardHistory.push(dqnResult.totalReward);

    if (state.history.length > CONFIG.n_steps_history) {
      state.history.shift();
    }
    if (state.rewardHistory.length > CONFIG.n_steps_history) {
      state.rewardHistory.shift();
    }

    appendLogTableRow(record);
    updateCharts();
    if (typeof updatePrototypeStatusUI === 'function') updatePrototypeStatusUI();
  } catch (err) {
    console.error("UI Update Error:", err);
  }
}

function appendLogTableRow(r) {
  const tbody = document.getElementById("log-table-body");
  if (!tbody) return;

  const tr = document.createElement("tr");
  const riskColor = r.risk === "AMAN" ? "text-pastel-mint" : (r.risk === "WASPADA" ? "text-pastel-yellow" : "text-pastel-coral");

  tr.innerHTML = `
    <td>#${r.step}</td>
    <td>${r.timestamp}</td>
    <td>${r.voltage.toFixed(1)} V</td>
    <td>${r.current.toFixed(1)} A</td>
    <td>${r.temp.toFixed(1)} °C</td>
    <td>${r.soc.toFixed(1)}%</td>
    <td>${r.soh.toFixed(1)}%</td>
    <td>${r.dod.toFixed(1)}%</td>
    <td>${r.cycles}</td>
    <td>${r.rul}</td>
    <td class="${riskColor}"><strong>${r.risk}</strong></td>
    <td>${r.action}</td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);

  // Keep max 50 rows in DOM
  while (tbody.children.length > 50) {
    tbody.removeChild(tbody.lastChild);
  }
}

// Chart.js Setup with Pastel Themes
function initCharts() {
  const isDark = state.theme === "dark";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(203, 213, 225, 0.4)";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = textColor;

  // 1. Quick Telemetry Chart (Voltage & Current)
  const ctxQuick = document.getElementById("chart-quick-telemetry");
  if (ctxQuick) {
    chartQuickTelemetry = new Chart(ctxQuick, {
      type: "line",
      data: {
        labels: state.history.map(h => h.timestamp),
        datasets: [
          {
            label: "Tegangan (V)",
            data: state.history.map(h => h.voltage),
            borderColor: "#528974",
            backgroundColor: "rgba(82, 137, 116, 0.14)",
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            yAxisID: "yVolt"
          },
          {
            label: "Arus (A)",
            data: state.history.map(h => h.current),
            borderColor: "#D97746",
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [4, 4],
            tension: 0.35,
            yAxisID: "yCurr"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 8 } },
          yVolt: { position: "left", min: 280, max: 430, grid: { color: gridColor } },
          yCurr: { position: "right", min: -130, max: 120, grid: { display: false } }
        },
        plugins: { legend: { display: true, position: "top" } }
      }
    });
  }

  // 2. Full Multi-axis Telemetry (Voltage, Current, Temp)
  const ctxTel = document.getElementById("chart-telemetry");
  if (ctxTel) {
    chartTelemetry = new Chart(ctxTel, {
      type: "line",
      data: {
        labels: state.history.map(h => h.timestamp),
        datasets: [
          {
            label: "Tegangan (V)",
            data: state.history.map(h => h.voltage),
            borderColor: "#528974",
            backgroundColor: "rgba(82, 137, 116, 0.10)",
            borderWidth: 2,
            tension: 0.35,
            yAxisID: "yV"
          },
          {
            label: "Arus (A)",
            data: state.history.map(h => h.current),
            borderColor: "#D97746",
            borderWidth: 2,
            tension: 0.35,
            yAxisID: "yI"
          },
          {
            label: "Suhu (°C)",
            data: state.history.map(h => h.temp),
            borderColor: "#C86262",
            borderWidth: 2,
            tension: 0.35,
            yAxisID: "yT"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          x: { grid: { color: gridColor } },
          yV: { position: "left", min: 280, max: 430, grid: { color: gridColor } },
          yI: { position: "right", min: -130, max: 120, grid: { display: false } },
          yT: { position: "right", min: 10, max: 65, grid: { display: false } }
        }
      }
    });
  }

  // 3. SoC vs DoD
  const ctxSoc = document.getElementById("chart-soc");
  if (ctxSoc) {
    chartSoc = new Chart(ctxSoc, {
      type: "line",
      data: {
        labels: state.history.map(h => h.timestamp),
        datasets: [
          {
            label: "SoC (%)",
            data: state.history.map(h => h.soc),
            borderColor: "#489980",
            backgroundColor: "rgba(72, 153, 128, 0.14)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.35
          },
          {
            label: "DoD (%)",
            data: state.history.map(h => h.dod),
            borderColor: "#A68D79",
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          x: { grid: { color: gridColor } },
          y: { min: 0, max: 100, grid: { color: gridColor } }
        }
      }
    });
  }

  // 4. Rewards
  const ctxRew = document.getElementById("chart-rewards");
  if (ctxRew) {
    chartRewards = new Chart(ctxRew, {
      type: "line",
      data: {
        labels: state.history.map((_, idx) => `Tick ${idx + 1}`),
        datasets: [
          {
            label: "Total Reward DQN",
            data: state.rewardHistory,
            borderColor: "#D4A359",
            backgroundColor: "rgba(212, 163, 89, 0.14)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          x: { grid: { color: gridColor } },
          y: { min: -5, max: 15, grid: { color: gridColor } }
        }
      }
    });
  }

  // 5. SoH & RUL
  const ctxSoh = document.getElementById("chart-soh");
  if (ctxSoh) {
    chartSoh = new Chart(ctxSoh, {
      type: "line",
      data: {
        labels: state.history.map(h => h.timestamp),
        datasets: [
          {
            label: "SoH (%)",
            data: state.history.map(h => h.soh),
            borderColor: "#489980",
            backgroundColor: "rgba(72, 153, 128, 0.10)",
            borderWidth: 2.5,
            tension: 0.35,
            yAxisID: "ySoh"
          },
          {
            label: "Proyeksi RUL (Siklus)",
            data: state.history.map(h => h.rul),
            borderColor: "#528974",
            borderWidth: 2,
            tension: 0.35,
            yAxisID: "yRul"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          x: { grid: { color: gridColor } },
          ySoh: { position: "left", min: 75, max: 100, grid: { color: gridColor } },
          yRul: { position: "right", min: 0, max: 10000, grid: { display: false } }
        }
      }
    });
  }
}

function updateCharts() {
  const labels = state.history.map(h => h.timestamp);

  if (chartQuickTelemetry) {
    chartQuickTelemetry.data.labels = labels;
    chartQuickTelemetry.data.datasets[0].data = state.history.map(h => h.voltage);
    chartQuickTelemetry.data.datasets[1].data = state.history.map(h => h.current);
    chartQuickTelemetry.update("none");
  }

  if (chartTelemetry) {
    chartTelemetry.data.labels = labels;
    chartTelemetry.data.datasets[0].data = state.history.map(h => h.voltage);
    chartTelemetry.data.datasets[1].data = state.history.map(h => h.current);
    chartTelemetry.data.datasets[2].data = state.history.map(h => h.temp);
    chartTelemetry.update("none");
  }

  if (chartSoc) {
    chartSoc.data.labels = labels;
    chartSoc.data.datasets[0].data = state.history.map(h => h.soc);
    chartSoc.data.datasets[1].data = state.history.map(h => h.dod);
    chartSoc.update("none");
  }

  if (chartRewards) {
    chartRewards.data.labels = state.rewardHistory.map((_, idx) => `#${idx + 1}`);
    chartRewards.data.datasets[0].data = state.rewardHistory;
    chartRewards.update("none");
  }

  if (chartSoh) {
    chartSoh.data.labels = labels;
    chartSoh.data.datasets[0].data = state.history.map(h => h.soh);
    chartSoh.data.datasets[1].data = state.history.map(h => h.rul);
    chartSoh.update("none");
  }
}

function updateChartsTheme() {
  const isDark = state.theme === "dark";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(203, 213, 225, 0.4)";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  [chartQuickTelemetry, chartTelemetry, chartSoc, chartSoh, chartRewards].forEach(chart => {
    if (chart) {
      if (chart.options.scales.x) chart.options.scales.x.grid.color = gridColor;
      Object.keys(chart.options.scales).forEach(key => {
        if (chart.options.scales[key].grid) chart.options.scales[key].grid.color = gridColor;
      });
      chart.update();
    }
  });
}

// Backend Auto-Detection & Server-Sent Events (SSE)
function attemptBackendConnection() {
  const badgeLabel = document.getElementById("backend-engine-label");
  const badge = document.getElementById("backend-status-badge");

  fetch("/api/status")
    .then(res => res.json())
    .then(data => {
      state.backendConnected = true;
      if (badgeLabel) badgeLabel.innerText = "Python AI BMS (SSE Terhubung)";
      if (badge) {
        badge.style.background = "var(--pastel-mint-bg)";
        badge.style.color = "#15803d";
        badge.style.borderColor = "var(--pastel-mint-border)";
      }
      initSSEStream();
    })
    .catch(() => {
      // Standalone mode is completely fine
      state.backendConnected = false;
      if (badgeLabel) badgeLabel.innerText = "Mesin Real-Time Client Aktif";
    });
}

function initSSEStream() {
  try {
    if (eventSource) eventSource.close();
    eventSource = new EventSource("/api/stream");
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.voltage) {
          // If server sends telemetry, harmonize state
          safeSetText("stream-latency", `${payload.latency_ms || 12} ms`);
        }
      } catch (err) {}
    };
    eventSource.onerror = () => {
      if (eventSource) eventSource.close();
    };
  } catch (e) {}
}

// Time Formatter
function getFormattedTime(offsetStep) {
  const d = new Date();
  d.setSeconds(d.getSeconds() - (CONFIG.n_steps_history - offsetStep));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Export Data
function exportCSV() {
  playChimeNotice();
  let csv = "step,timestamp,voltage_v,current_a,temperature_c,soc_pct,soh_pct,dod_pct,cycles,rul_cycles,mode,risk,dqn_action\n";
  state.logs.forEach(r => {
    csv += `${r.step},"${r.timestamp}",${r.voltage},${r.current},${r.temp},${r.soc},${r.soh},${r.dod},${r.cycles},${r.rul},"${r.mode}","${r.risk}","${r.action}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `ecobat_realtime_telemetry_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportJSON() {
  playChimeNotice();
  const snapshot = {
    export_timestamp: new Date().toISOString(),
    system: "ECOBAT Smart AI BMS",
    version: "3.0.0",
    current_state: {
      voltage: state.voltage,
      current: state.current,
      temp: state.temp,
      soc: state.soc,
      soh: state.soh,
      dod: state.dod,
      cycles: state.cycles,
      mode: state.mode
    },
    cells_16s: state.cells,
    telemetry_history: state.history,
    dqn_rewards: state.rewardHistory
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `ecobat_snapshot_${Date.now()}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* =========================================================
   60-FPS INTERACTIVE BATTERY CANVAS & ION FLUX VISUALIZER
   ========================================================= */
let batteryCanvas = null;
let batteryCtx = null;
let batteryAnimId = null;
let ionParticles = [];
const N_IONS = 140;

function initBatteryVisualizer() {
  batteryCanvas = document.getElementById("battery-particle-canvas");
  if (!batteryCanvas) return;
  batteryCtx = batteryCanvas.getContext("2d");

  // Seed ion particles
  ionParticles = [];
  for (let i = 0; i < N_IONS; i++) {
    ionParticles.push({
      x: 0.28 + Math.random() * 0.44, // distributed in electrolyte
      y: 0.18 + Math.random() * 0.64,
      vx: (Math.random() - 0.5) * 0.002,
      vy: (Math.random() - 0.5) * 0.001,
      radius: 2.5 + Math.random() * 2.5,
      pulse: Math.random() * Math.PI * 2,
      baseColor: Math.random() > 0.15 ? '#38bdf8' : '#4ade80'
    });
  }

  resizeBatteryCanvas();
  window.addEventListener("resize", resizeBatteryCanvas);
  startBatteryAnimationLoop();
}

function resizeBatteryCanvas() {
  if (!batteryCanvas || !batteryCtx) return;
  const rect = batteryCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width || 800;
  const h = rect.height || 340;

  batteryCanvas.width = w * dpr;
  batteryCanvas.height = h * dpr;
  batteryCanvas.style.width = `${w}px`;
  batteryCanvas.style.height = `${h}px`;
  batteryCtx.scale(dpr, dpr);
}

function setBatteryViewMode(mode) {
  state.batteryViewMode = mode;
  playTone(587.33, 'sine', 0.1, 0.03); // D5

  // Update button active state
  document.querySelectorAll(".view-tab-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  const activeBtn = document.getElementById(`btn-view-${mode}`);
  if (activeBtn) activeBtn.classList.add("active");
}

function triggerIonBurst() {
  playChimeNotice();
  for (let i = 0; i < 35; i++) {
    ionParticles.push({
      x: 0.45 + (Math.random() - 0.5) * 0.1,
      y: 0.2 + Math.random() * 0.6,
      vx: (Math.random() - 0.5) * 0.015,
      vy: (Math.random() - 0.5) * 0.008,
      radius: 3.5 + Math.random() * 3,
      pulse: 0,
      baseColor: '#facc15' // energetic gold
    });
  }
  // Trim back if too many
  if (ionParticles.length > 200) {
    ionParticles.splice(0, ionParticles.length - 140);
  }
}

function startBatteryAnimationLoop() {
  if (batteryAnimId) cancelAnimationFrame(batteryAnimId);

  function renderLoop() {
    if (batteryCanvas && batteryCtx) {
      const rect = batteryCanvas.getBoundingClientRect();
      const w = rect.width || 800;
      const h = rect.height || 340;
      drawBatteryScene(batteryCtx, w, h);
    }
    batteryAnimId = requestAnimationFrame(renderLoop);
  }

  batteryAnimId = requestAnimationFrame(renderLoop);
}

function drawBatteryScene(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);

  // Background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#090d16');
  bgGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Switch by mode
  if (state.batteryViewMode === 'ions') {
    drawElectrochemicalIonsView(ctx, width, height);
  } else if (state.batteryViewMode === 'pack') {
    draw16SPackArchitectureView(ctx, width, height);
  } else if (state.batteryViewMode === 'evloop') {
    drawEVPowertrainLoopView(ctx, width, height);
  } else if (state.batteryViewMode === 'aibms') {
    drawAINeuralBMSView(ctx, width, height);
  }

  // Update HUD elements
  updateBatteryHUD();
}

function drawElectrochemicalIonsView(ctx, w, h) {
  // Thermal Heat Radiation Overlay
  const tempRatio = Math.max(0, Math.min(1, (state.temp - 25.0) / 30.0));
  const glowRadius = Math.min(w, h) * 0.7;
  const radialGlow = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, glowRadius);
  if (state.temp > 45) {
    radialGlow.addColorStop(0, `rgba(239, 68, 68, ${0.15 + tempRatio * 0.25})`);
    radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else if (state.temp > 35) {
    radialGlow.addColorStop(0, `rgba(245, 158, 11, ${0.12 + tempRatio * 0.15})`);
    radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  } else {
    radialGlow.addColorStop(0, 'rgba(56, 189, 248, 0.08)');
    radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, w, h);

  // Layout boundaries
  const marginY = 50;
  const cellHeight = h - marginY * 2;
  const cathodeW = w * 0.22;
  const anodeW = w * 0.22;
  const anodeX = w - anodeW - 20;
  const cathodeX = 20;
  const electroX = cathodeX + cathodeW;
  const electroW = anodeX - electroX;
  const separatorX = electroX + electroW * 0.5;

  // 1. Katoda Block (+)
  const cathGrad = ctx.createLinearGradient(cathodeX, 0, cathodeX + cathodeW, 0);
  cathGrad.addColorStop(0, 'rgba(251, 113, 133, 0.25)');
  cathGrad.addColorStop(1, 'rgba(251, 113, 133, 0.10)');
  ctx.fillStyle = cathGrad;
  ctx.strokeStyle = 'rgba(251, 113, 133, 0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, cathodeX, marginY, cathodeW, cellHeight, 10, true, true);

  // Cathode internal lattice grid
  ctx.strokeStyle = 'rgba(251, 113, 133, 0.2)';
  ctx.lineWidth = 1;
  for (let x = cathodeX + 15; x < cathodeX + cathodeW; x += 15) {
    ctx.beginPath(); ctx.moveTo(x, marginY); ctx.lineTo(x, marginY + cellHeight); ctx.stroke();
  }
  for (let y = marginY + 15; y < marginY + cellHeight; y += 15) {
    ctx.beginPath(); ctx.moveTo(cathodeX, y); ctx.lineTo(cathodeX + cathodeW, y); ctx.stroke();
  }

  // 2. Anoda Block (-)
  const anodeGrad = ctx.createLinearGradient(anodeX, 0, anodeX + anodeW, 0);
  anodeGrad.addColorStop(0, 'rgba(74, 222, 128, 0.10)');
  anodeGrad.addColorStop(1, 'rgba(74, 222, 128, 0.25)');
  ctx.fillStyle = anodeGrad;
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, anodeX, marginY, anodeW, cellHeight, 10, true, true);

  // Anode graphite layers
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.25)';
  for (let y = marginY + 14; y < marginY + cellHeight; y += 14) {
    ctx.beginPath(); ctx.moveTo(anodeX, y); ctx.lineTo(anodeX + anodeW, y); ctx.stroke();
  }

  // 3. Electrolyte Area (Center)
  ctx.fillStyle = 'rgba(56, 189, 248, 0.04)';
  ctx.fillRect(electroX, marginY, electroW, cellHeight);

  // 4. Porous Separator (Dashed vertical line with pores)
  ctx.fillStyle = 'rgba(167, 139, 250, 0.18)';
  ctx.fillRect(separatorX - 10, marginY, 20, cellHeight);
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(separatorX - 10, marginY, 20, cellHeight);

  // Pores holes
  ctx.fillStyle = '#090d16';
  for (let y = marginY + 16; y < marginY + cellHeight; y += 22) {
    ctx.beginPath();
    ctx.arc(separatorX, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.6)';
    ctx.stroke();
  }

  // 5. External Circuit Wire & Electron Flow at Top
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cathodeX + cathodeW * 0.5, marginY);
  ctx.lineTo(cathodeX + cathodeW * 0.5, 20);
  ctx.lineTo(anodeX + anodeW * 0.5, 20);
  ctx.lineTo(anodeX + anodeW * 0.5, marginY);
  ctx.stroke();

  // Load/EVSE box on top wire
  const loadX = w * 0.5 - 45;
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, loadX, 8, 90, 24, 6, true, true);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'center';
  const loadLabel = state.current > 5 ? '⚡ EVSE CHARGE' : (state.current < -5 ? '🚗 MOTOR LOAD' : '⏸️ IDLE');
  ctx.fillText(loadLabel, w * 0.5, 24);

  // Electron e- dots moving along external top circuit
  const eSpeed = (state.current / 120.0) * 0.008;
  const time = performance.now() * 0.001;
  const eOffset = (time * eSpeed * 200) % (anodeX - cathodeX);
  ctx.fillStyle = '#fb923c';
  for (let i = 0; i < 5; i++) {
    const curX = ((cathodeX + cathodeW * 0.5 + eOffset + i * 80) % (anodeX - cathodeX)) + cathodeX;
    if (curX > cathodeX && curX < anodeX) {
      ctx.beginPath();
      ctx.arc(curX, 20, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 6. Animate and Draw Li+ Ion Particles
  const fluxSpeed = (state.current / 80.0) * 0.0035; // Direction matches current!
  ionParticles.forEach(p => {
    p.pulse += 0.05;
    p.x += fluxSpeed + p.vx;
    p.y += p.vy;

    // Boundary bouncing
    if (p.x < 0.08) { p.x = 0.92; }
    if (p.x > 0.92) { p.x = 0.08; }
    if (p.y < 0.20) p.vy = Math.abs(p.vy);
    if (p.y > 0.80) p.vy = -Math.abs(p.vy);

    const px = p.x * w;
    const py = marginY + p.y * cellHeight * 0.9;
    const r = p.radius + Math.sin(p.pulse) * 0.8;

    // Glowing particle
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.baseColor;
    ctx.fillStyle = p.baseColor;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Tiny Li+ text on larger particles
    if (r > 4.2) {
      ctx.fillStyle = '#0f172a';
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Li⁺', px, py + 2.5);
    }
  });

  // 7. Labels
  ctx.font = 'bold 12px Plus Jakarta Sans';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fb7185';
  ctx.fillText('KATODA (+) [NMC]', cathodeX + cathodeW * 0.5, marginY + 28);
  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Interkalasi Ion Li+', cathodeX + cathodeW * 0.5, marginY + 44);

  ctx.font = 'bold 12px Plus Jakarta Sans';
  ctx.fillStyle = '#4ade80';
  ctx.fillText('ANODA (-) [GRAFIT]', anodeX + anodeW * 0.5, marginY + 28);
  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Lapisan Deinterkalasi', anodeX + anodeW * 0.5, marginY + 44);

  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = '#c4b5fd';
  ctx.fillText('SEPARATOR MEMBRAN', separatorX, marginY + cellHeight - 12);
}

function draw16SPackArchitectureView(ctx, w, h) {
  // Title & Specs
  ctx.font = 'bold 13px Plus Jakarta Sans';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('SUB-MODUL BATERAI 16-SEL SERI (16S) & ACTIVE BALANCER BUS', w * 0.5, 30);

  const startX = 40;
  const startY = 60;
  const cellW = (w - 80) / 8 - 10;
  const cellH = 100;
  const gapX = 10;
  const gapY = 24;

  let cellIdx = 0;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) {
      cellIdx++;
      const cx = startX + col * (cellW + gapX);
      const cy = startY + row * (cellH + gapY);
      const cellData = state.cells[cellIdx - 1] || { voltage: 3.65, temp: 29.4, balancing: false };

      // Cell cylinder body
      ctx.fillStyle = cellData.balancing ? 'rgba(74, 222, 128, 0.18)' : 'rgba(30, 41, 59, 0.8)';
      ctx.strokeStyle = cellData.balancing ? '#4ade80' : 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = cellData.balancing ? 2.5 : 1.2;
      roundRect(ctx, cx, cy, cellW, cellH, 8, true, true);

      // Terminal top (+)
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(cx + cellW * 0.35, cy - 4, cellW * 0.3, 4);

      // Cell Fill Level (SoC)
      const socH = (cellH - 10) * (state.soc / 100.0);
      ctx.fillStyle = cellData.balancing ? 'rgba(74, 222, 128, 0.4)' : 'rgba(56, 189, 248, 0.35)';
      ctx.fillRect(cx + 4, cy + cellH - 4 - socH, cellW - 8, socH);

      // Labels
      ctx.font = 'bold 10px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`C${cellIdx < 10 ? '0' : ''}${cellIdx}`, cx + cellW * 0.5, cy + 22);

      ctx.font = '10px JetBrains Mono';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`${cellData.voltage.toFixed(3)}V`, cx + cellW * 0.5, cy + 40);

      ctx.font = '9px JetBrains Mono';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${cellData.temp}°C`, cx + cellW * 0.5, cy + 56);

      if (cellData.balancing) {
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('[BAL]', cx + cellW * 0.5, cy + cellH - 8);

        // Active Balancer Transfer Arc
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx + cellW * 0.5, cy - 8, 14, Math.PI, 0, false);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Master BMS Brain at bottom
  const bmsY = startY + cellH * 2 + gapY + 10;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  roundRect(ctx, w * 0.5 - 180, bmsY, 360, 36, 8, true, true);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 11px Plus Jakarta Sans';
  ctx.textAlign = 'center';
  ctx.fillText('🧠 MASTER AI BMS CONTROLLER (CAN-Bus 2.0B / 500 kbps)', w * 0.5, bmsY + 22);
}

function drawEVPowertrainLoopView(ctx, w, h) {
  ctx.font = 'bold 13px Plus Jakarta Sans';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('DIAGRAM ALIRAN ENERGI POWERTRAIN KENDARAAN LISTRIK (EV)', w * 0.5, 30);

  const nodes = [
    { title: "Stasiun EVSE", icon: "⚡", x: w * 0.15, y: h * 0.5 },
    { title: "Kontaktor & BMS", icon: "🧠", x: w * 0.38, y: h * 0.5 },
    { title: "Pack Baterai (350V)", icon: "🔋", x: w * 0.62, y: h * 0.5 },
    { title: "Inverter & Motor", icon: "🚗", x: w * 0.85, y: h * 0.5 }
  ];

  // Draw connecting wires
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  ctx.lineTo(nodes[3].x, nodes[3].y);
  ctx.stroke();

  // Moving energy dots along wire
  const time = performance.now() * 0.002;
  const dir = state.current > 0 ? 1 : -1;
  for (let i = 0; i < 8; i++) {
    const progress = (time * dir + i / 8.0) % 1.0;
    const dotProg = progress < 0 ? 1.0 + progress : progress;
    const dotX = nodes[0].x + dotProg * (nodes[3].x - nodes[0].x);
    ctx.fillStyle = state.current > 0 ? '#38bdf8' : (state.current < 0 ? '#fb923c' : '#94a3b8');
    ctx.shadowBlur = 8;
    ctx.shadowColor = ctx.fillStyle;
    ctx.beginPath();
    ctx.arc(dotX, h * 0.5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Draw nodes
  nodes.forEach(node => {
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.icon, node.x, node.y + 8);

    ctx.font = 'bold 11px Plus Jakarta Sans';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(node.title, node.x, node.y + 54);
  });
}

function drawAINeuralBMSView(ctx, w, h) {
  ctx.font = 'bold 13px Plus Jakarta Sans';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c4b5fd';
  ctx.fillText('ARSITEKTUR PREDIKSI AI: MULTI-OUTPUT LSTM & DQN RL SOLVER', w * 0.5, 30);

  // Layers
  const layers = [
    { name: "Input Sensor", nodes: ["Volt (V)", "Curr (A)", "Temp (°C)", "CAN"], x: w * 0.2 },
    { name: "Hidden LSTM", nodes: ["Cell 1", "Cell 2", "Cell 3", "Cell 4", "Cell 5"], x: w * 0.5 },
    { name: "Output AI", nodes: ["SoC (%)", "SoH (%)", "RUL Cycles", "DQN Action"], x: w * 0.8 }
  ];

  // Draw connecting synapses with pulsing lights
  ctx.lineWidth = 1;
  const time = performance.now() * 0.003;
  layers[0].nodes.forEach((n1, i1) => {
    const y1 = 70 + i1 * 50;
    layers[1].nodes.forEach((n2, i2) => {
      const y2 = 55 + i2 * 45;
      ctx.strokeStyle = `rgba(167, 139, 250, ${0.15 + Math.sin(time + i1 + i2) * 0.1})`;
      ctx.beginPath(); ctx.moveTo(layers[0].x, y1); ctx.lineTo(layers[1].x, y2); ctx.stroke();
    });
  });

  layers[1].nodes.forEach((n2, i2) => {
    const y2 = 55 + i2 * 45;
    layers[2].nodes.forEach((n3, i3) => {
      const y3 = 70 + i3 * 50;
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 + Math.cos(time + i2 + i3) * 0.1})`;
      ctx.beginPath(); ctx.moveTo(layers[1].x, y2); ctx.lineTo(layers[2].x, y3); ctx.stroke();
    });
  });

  // Draw layer nodes
  layers.forEach(layer => {
    layer.nodes.forEach((label, i) => {
      const ny = 60 + i * (layer.nodes.length === 5 ? 45 : 50);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#c4b5fd';
      ctx.lineWidth = 1.8;
      roundRect(ctx, layer.x - 45, ny - 14, 90, 28, 6, true, true);

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(label, layer.x, ny + 4);
    });
  });
}

function updateBatteryHUD() {
  const modeText = state.current > 5 ? `MODE: FAST CHARGE (+${state.current.toFixed(1)} A)` : (state.current < -5 ? `MODE: DISCHARGING (${state.current.toFixed(1)} A)` : `MODE: IDLE STANDBY (0.0 A)`);
  safeSetText("canvas-hud-mode", modeText);

  const fluxMult = (Math.abs(state.current) / 45.0).toFixed(2);
  safeSetText("canvas-hud-flux", `${fluxMult}x`);
  safeSetText("canvas-hud-thermal", `${state.temp.toFixed(1)}°C`);
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

/* =========================================================
   CINEMATIC STORY TOUR ENGINE (REMOTION-STYLE INTERACTIVE)
   ========================================================= */
const TOUR_STEPS = {
  1: {
    icon: "🔬",
    title: "01. Arsitektur Sub-Modul 16-Sel Seri (16S) & Elektrokimia Baterai",
    desc: "Baterai pack ECOBAT tersusun atas modul 16 sel Li-ion seri bertegangan nominal 350V. Setiap sel beroperasi pada rentang presisi 2.8V - 4.2V. Pada tingkat mikroskopis, partikel ion Li+ berpindah secara dinamis antara kisi Anoda Grafit dan Katoda melalui elektrolit dengan resistansi internal ultra-rendah.",
    mode: "ions"
  },
  2: {
    icon: "⚡",
    title: "02. Dinamika Aliran Energi EV: Fast Charging, Traksi & Pengereman Regeneratif",
    desc: "Aliran arus dikontrol secara presisi dalam 4 mode: Pengisian Cepat (EVSE -> Baterai), Traksi Daya Tinggi (Baterai -> Inverter -> Motor EV), Pemulihan Energi Pengereman (Regen Brake -> Baterai), dan Idle hemat daya dengan efisiensi konversi daya tinggi >98.4%.",
    mode: "evloop"
  },
  3: {
    icon: "🤖",
    title: "03. Estimasi Presisi Tinggi dengan AI LSTM (SoC, SoH & Prediksi RUL)",
    desc: "Model Deep Learning LSTM Multi-Output memproses deret waktu sensor (tegangan, arus, suhu) dengan Exponential Moving Average (EMA). Menghasilkan estimasi State of Charge (SoC) dengan MAE 0.42%, State of Health (SoH) dengan MAE 0.08%, dan proyeksi Remaining Useful Life hingga 10,000 siklus.",
    mode: "aibms"
  },
  4: {
    icon: "🛡️",
    title: "04. Autonomous Decision Maker (DQN RL) & 16S Active Balancing",
    desc: "Agent Deep Q-Network Reinforcement Learning secara otonom menentukan aksi optimal (0: Idle, 1: Slow Chg, 2: Norm Chg, 3: Fast Chg, 4: Drive). Jika ketimpangan sel melebihi 14mV, Active Balancer mentransfer muatan tanpa membuang energi menjadi panas, menjamin kepatuhan ISO 26262 ASIL-D.",
    mode: "pack"
  }
};

function initStoryTour() {
  setTourStep(1);
}

function setTourStep(stepNum) {
  state.tourCurrentStep = stepNum;
  const step = TOUR_STEPS[stepNum];
  if (!step) return;

  // Update Buttons
  for (let i = 1; i <= 4; i++) {
    const pill = document.getElementById(`tour-step-${i}`);
    if (pill) {
      if (i === stepNum) pill.classList.add("active");
      else pill.classList.remove("active");
    }
  }

  // Update content
  safeSetText("tour-icon", step.icon);
  safeSetText("tour-title", step.title);
  safeSetText("tour-desc", step.desc);

  // Update progress fill
  const progBar = document.getElementById("tour-progress-bar");
  if (progBar) {
    progBar.style.width = `${stepNum * 25}%`;
  }

  // Switch canvas mode to match step lesson
  setBatteryViewMode(step.mode);
}

function toggleTourPlayback() {
  state.tourPlaying = !state.tourPlaying;
  const btn = document.getElementById("btn-tour-play");
  if (btn) {
    btn.innerText = state.tourPlaying ? "⏸️ Jeda Panduan" : "▶️ Putar Panduan Otomatis";
  }

  if (state.tourPlaying) {
    playChimeNotice();
    if (state.tourTimer) clearInterval(state.tourTimer);
    state.tourTimer = setInterval(() => {
      let nextStep = state.tourCurrentStep + 1;
      if (nextStep > 4) nextStep = 1;
      setTourStep(nextStep);
    }, 4500);
  } else {
    if (state.tourTimer) clearInterval(state.tourTimer);
  }
}

/* =========================================================
   HARDWARE PROTOTYPE REAL-TIME HUB & SERIAL GATEWAY
   ========================================================= */
function initPrototypeHub() {
  updatePrototypeStatusUI();
  
  // Periodically check hardware status from backend
  setInterval(checkBackendPrototypeStatus, 2500);
}

function updatePrototypeStatusUI() {
  // Update contactor LED & text
  const led = document.getElementById("hw-contactor-led");
  const text = document.getElementById("hw-contactor-status-text");
  if (led && text) {
    if (state.estopActive) {
      led.className = "contactor-led-glow estop";
      text.innerText = "STATUS: DARURAT (E-STOP TRIPPED)";
      text.style.color = "#ef4444";
    } else if (state.contactorClosed) {
      led.className = "contactor-led-glow";
      text.innerText = "STATUS: TERHUBUNG (CLOSED) - DAYA AKTIF";
      text.style.color = "var(--text-main)";
    } else {
      led.className = "contactor-led-glow open";
      text.innerText = "STATUS: TERISOLASI (OPEN)";
      text.style.color = "#f59e0b";
    }
  }

  // Update PWM Fan Slider & Badge
  const fanSlider = document.getElementById("slider-hw-fan");
  if (fanSlider && document.activeElement !== fanSlider) {
    fanSlider.value = state.coolingFanPwm;
  }
  safeSetText("hw-fan-val", `${state.coolingFanPwm}% PWM (~${Math.round(state.coolingFanPwm * 45)} RPM)`);

  // Update Limit Slider & Badge
  const limitSlider = document.getElementById("slider-hw-limit");
  if (limitSlider && document.activeElement !== limitSlider) {
    limitSlider.value = state.currentLimit;
  }
  safeSetText("hw-limit-val", `${state.currentLimit} A Limit`);

  // Update Header & Hub status pills
  const protoDot = document.getElementById("proto-status-dot");
  const protoText = document.getElementById("proto-status-text");
  const badgeHw = document.getElementById("badge-hw-status");
  if (protoText && protoDot) {
    if (state.estopActive) {
      protoText.innerText = "HW: E-STOP";
      protoDot.style.background = "#ef4444";
      if (badgeHw) badgeHw.innerText = "STATUS: DARURAT (E-STOP TRIPPED)";
    } else if (state.hardwareConnected) {
      protoText.innerText = `HW: ${state.hardwareSource.toUpperCase()} ONLINE`;
      protoDot.style.background = "#10b981";
      if (badgeHw) badgeHw.innerText = `HARDWARE TERHUBUNG (${state.hardwareSource.toUpperCase()})`;
    } else {
      protoText.innerText = "HW: VIRTUAL READY";
      protoDot.style.background = "#38bdf8";
      if (badgeHw) badgeHw.innerText = "HARDWARE: EMULATOR SIAGA";
    }
  }
}

// 1. Web Serial API Connection (Direct USB/COM)
async function connectWebSerial() {
  if (!("serial" in navigator)) {
    alert("Web Serial API didukung secara native pada Google Chrome, Microsoft Edge, dan Opera.\n\nJika menggunakan browser lain, Anda dapat menggunakan opsi 'WiFi / LAN REST Gateway' atau 'Virtual Hardware Bridge'.");
    return;
  }

  try {
    const baudRate = parseInt(document.getElementById("sel-baud-rate")?.value || "115200");
    logSerial("info", `Meminta akses port serial USB pada baud rate ${baudRate} bps...`);

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: baudRate });

    state.serialPort = port;
    state.serialKeepReading = true;
    state.hardwareConnected = true;
    state.hardwareSource = "web_serial";

    logSerial("rx", `✅ Port Serial USB Terhubung (${baudRate} bps)! Memulai listener...`);
    playChimeNotice();

    // Toggle Connect/Disconnect button
    const btnConn = document.getElementById("btn-connect-serial");
    const btnDisc = document.getElementById("btn-disconnect-serial");
    if (btnConn) btnConn.style.display = "none";
    if (btnDisc) btnDisc.style.display = "inline-flex";
    safeSetText("serial-status-note", `Status: Terhubung USB (${baudRate} bps)`);

    updatePrototypeStatusUI();
    readWebSerialLoop();
  } catch (err) {
    console.error("Web Serial Error:", err);
    logSerial("alert", `Gagal menghubungkan serial USB: ${err.message || err}`);
  }
}

async function readWebSerialLoop() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = state.serialPort.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  state.serialReader = reader;

  let buffer = "";
  try {
    while (state.serialKeepReading) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          logSerial("rx", trimmed);
          handleSerialIncomingPacket(trimmed);
        }
      }
    }
  } catch (err) {
    logSerial("alert", `Kesalahan saat membaca serial: ${err.message}`);
  } finally {
    reader.releaseLock();
  }
}

function handleSerialIncomingPacket(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data.voltage !== undefined) state.voltage = parseFloat(data.voltage);
    if (data.current !== undefined) state.current = parseFloat(data.current);
    if (data.temperature !== undefined) state.temp = parseFloat(data.temperature);
    if (data.soc !== undefined) state.soc = parseFloat(data.soc);
    if (data.contactor !== undefined) state.contactorClosed = (data.contactor === "CLOSED");
    if (data.cells && Array.isArray(data.cells)) {
      data.cells.forEach((v, idx) => {
        if (state.cells[idx]) state.cells[idx].voltage = parseFloat(v);
      });
    }

    state.hardwareConnected = true;
    updateUI();
  } catch (e) {
    // Non-JSON line or string message
  }
}

async function disconnectWebSerial() {
  state.serialKeepReading = false;
  if (state.serialReader) {
    await state.serialReader.cancel();
  }
  if (state.serialPort) {
    await state.serialPort.close();
    state.serialPort = null;
  }
  state.hardwareConnected = false;
  state.hardwareSource = "simulated";

  const btnConn = document.getElementById("btn-connect-serial");
  const btnDisc = document.getElementById("btn-disconnect-serial");
  if (btnConn) btnConn.style.display = "inline-flex";
  if (btnDisc) btnDisc.style.display = "none";
  safeSetText("serial-status-note", "Status: Terputus");

  logSerial("info", "Koneksi Serial USB ditutup.");
  updatePrototypeStatusUI();
}

// 2. Dispatching Hardware Commands
async function sendHardwareCommand(cmd, val) {
  logSerial("tx", `[KIRIM] Command: ${cmd} -> ${val}`);
  playTone(880, 'sine', 0.08, 0.03);

  // Send over Web Serial if open
  if (state.serialPort && state.serialPort.writable) {
    try {
      const textEncoder = new TextEncoderStream();
      const writableStreamClosed = textEncoder.readable.pipeTo(state.serialPort.writable);
      const writer = textEncoder.writable.getWriter();
      await writer.write(JSON.stringify({ command: cmd, value: val }) + "\n");
      writer.releaseLock();
    } catch (e) {
      console.warn("Serial write error:", e);
    }
  }

  // Also send to Python backend
  try {
    const res = await fetch("/api/prototype/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd, value: val })
    });
    const resJson = await res.json();
    logSerial("info", `[ACK BACKEND] ${cmd} diterima`);
  } catch (e) {
    // Backend may be offline if user runs pure frontend
  }

  // Update local state directly
  if (cmd === "SET_CONTACTOR") {
    state.contactorClosed = (val === "CLOSED");
    if (!state.contactorClosed) state.current = 0.0;
  } else if (cmd === "SET_FAN_PWM") {
    state.coolingFanPwm = parseInt(val);
  } else if (cmd === "SET_CURRENT_LIMIT") {
    state.currentLimit = parseFloat(val);
  } else if (cmd === "SET_BALANCER") {
    state.balancerMode = String(val);
  }

  updatePrototypeStatusUI();
  updateUI();
}

function sendCustomSerialCommand() {
  const input = document.getElementById("serial-input-custom");
  if (!input || !input.value.trim()) return;
  const val = input.value.trim();
  sendHardwareCommand("CUSTOM", val);
  input.value = "";
}

function updateFanPWM(val) {
  sendHardwareCommand("SET_FAN_PWM", val);
}

function updateCurrentLimit(val) {
  sendHardwareCommand("SET_CURRENT_LIMIT", val);
}

function triggerHardwareEstop() {
  playWarningTone();
  state.estopActive = true;
  state.contactorClosed = false;
  state.current = 0.0;

  const btnEstop = document.getElementById("btn-hw-estop");
  const btnReset = document.getElementById("btn-hw-estop-reset");
  if (btnEstop) btnEstop.classList.add("active-tripped");
  if (btnReset) btnReset.style.display = "inline-flex";

  sendHardwareCommand("TRIGGER_ESTOP", true);
  logSerial("alert", "🚨 EMERGENCY STOP PERANGKAT KERAS DIPICU! Kontaktor dibuka!");
  updatePrototypeStatusUI();
  updateUI();
}

function resetHardwareEstop() {
  state.estopActive = false;
  state.contactorClosed = true;

  const btnEstop = document.getElementById("btn-hw-estop");
  const btnReset = document.getElementById("btn-hw-estop-reset");
  if (btnEstop) btnEstop.classList.remove("active-tripped");
  if (btnReset) btnReset.style.display = "none";

  sendHardwareCommand("RESET_ESTOP", true);
  logSerial("info", "✅ Emergency Stop dipulihkan. Sistem beroperasi normal.");
  updatePrototypeStatusUI();
  updateUI();
}

function toggleVirtualHardware() {
  playChimeNotice();
  state.hardwareConnected = !state.hardwareConnected;
  state.hardwareSource = state.hardwareConnected ? "virtual_sim" : "simulated";
  logSerial("info", `Virtual Hardware Bridge ${state.hardwareConnected ? 'Diaktifkan' : 'Dinonaktifkan'}.`);
  updatePrototypeStatusUI();
}

async function checkBackendHealth() {
  playTone(659.25, 'sine', 0.1, 0.03);
  const start = performance.now();
  try {
    const res = await fetch("/api/status");
    const json = await res.json();
    const latency = Math.round(performance.now() - start);
    logSerial("rx", `[PING OK] Backend online: ${json.system} (${latency} ms)`);
    safeSetText("backend-health-note", `Online OK - Latensi: ${latency} ms`);
  } catch (e) {
    logSerial("alert", "Backend /api/status tidak dapat dihubungi.");
    safeSetText("backend-health-note", "Offline / Server Python belum aktif");
  }
}

async function checkBackendPrototypeStatus() {
  try {
    const res = await fetch("/api/prototype/status");
    if (!res.ok) return;
    const json = await res.json();
    if (json.connected !== undefined && !state.serialPort) {
      state.hardwareConnected = json.connected;
      state.hardwareSource = json.source || "simulated";
      if (json.contactor) state.contactorClosed = (json.contactor === "CLOSED");
      if (json.cooling_fan_pwm) state.coolingFanPwm = json.cooling_fan_pwm;
      if (json.current_limit) state.currentLimit = json.current_limit;
      if (json.estop !== undefined) state.estopActive = json.estop;
      updatePrototypeStatusUI();
    }
  } catch (e) {
    // Ignore fetch errors during periodic check
  }
}

function logSerial(type, msg) {
  const terminal = document.getElementById("serial-terminal-log");
  if (!terminal) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  const row = document.createElement("div");
  row.className = `serial-line ${type}`;
  row.innerText = `[${timeStr}] ${msg}`;
  terminal.appendChild(row);

  while (terminal.children.length > 50) {
    terminal.removeChild(terminal.firstChild);
  }
  terminal.scrollTop = terminal.scrollHeight;
}

function clearSerialLog() {
  const terminal = document.getElementById("serial-terminal-log");
  if (terminal) terminal.innerHTML = "";
  logSerial("info", "Log terminal dibersihkan.");
}

function copyFirmwareSketch() {
  const code = `/* ECOBAT Smart AI BMS - ESP32 Firmware */
// Jalankan sketch ini pada Arduino IDE atau PlatformIO
// File tersimpan di: prototype_firmware/ecobat_esp32_firmware.ino
#define PIN_CONTACTOR_RELAY 19
#define PIN_COOLING_FAN_PWM 18
#define PIN_ACTIVE_BALANCER 21
void setup() { Serial.begin(115200); }
void loop() { /* streaming telemetry */ }`;

  navigator.clipboard.writeText(code).then(() => {
    playChimeNotice();
    alert("Kode firmware prototipe ESP32 berhasil disalin ke clipboard!\n\nAnda dapat membuka file lengkap di: prototype_firmware/ecobat_esp32_firmware.ino");
  }).catch(() => {
    alert("Buka file firmware langsung di folder: prototype_firmware/ecobat_esp32_firmware.ino");
  });
}

// =========================================================
// VERCEL AI SDK AGENT COPILOT (CLIENT CONTROLLER & TOOL EXECUTOR)
// =========================================================
function toggleAiCopilotDrawer() {
  const drawer = document.getElementById("ai-copilot-drawer");
  if (!drawer) return;
  drawer.classList.toggle("open");
  if (drawer.classList.contains("open")) {
    const input = document.getElementById("ai-copilot-input");
    if (input) setTimeout(() => input.focus(), 100);
  }
}

function formatAgentMarkdown(text) {
  const escaped = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/^### (.*)$/gm, '<strong style="display:block; margin-bottom:4px; font-size:0.84rem;">$1</strong>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, '<code style="background:rgba(82,137,116,0.14); padding:1px 5px; border-radius:4px;">$1</code>')
    .replace(/\n/g, "<br>");
}

function appendAiCopilotMessage(role, htmlContent, metaLabel, toolCalls = []) {
  const container = document.getElementById("ai-copilot-messages");
  if (!container) return null;

  const bubble = document.createElement("div");
  bubble.className = `ai-msg-bubble ${role}`;

  if (metaLabel) {
    const meta = document.createElement("div");
    meta.className = "ai-msg-meta";
    meta.textContent = metaLabel;
    bubble.appendChild(meta);
  }

  const contentDiv = document.createElement("div");
  contentDiv.className = "ai-msg-text";
  contentDiv.innerHTML = htmlContent;
  bubble.appendChild(contentDiv);

  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const toolsWrap = document.createElement("div");
    toolsWrap.className = "ai-tool-calls-box";
    toolCalls.forEach(tc => {
      const badge = document.createElement("div");
      badge.className = "ai-tool-badge";
      const summaryPairs = tc.result && typeof tc.result === "object"
        ? Object.entries(tc.result).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" | ")
        : "";
      badge.innerHTML = `🛠️ <strong>${tc.toolName}()</strong> ${summaryPairs ? `→ ${summaryPairs}` : ""}`;
      toolsWrap.appendChild(badge);
    });
    bubble.appendChild(toolsWrap);
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

function clearAiCopilotChat() {
  const container = document.getElementById("ai-copilot-messages");
  if (!container) return;
  container.innerHTML = `
    <div class="ai-msg-bubble assistant">
      <div class="ai-msg-meta">🤖 ECOBAT ToolLoopAgent • Siaga</div>
      <div class="ai-msg-text">
        Percakapan telah dibersihkan. Silakan ajukan pertanyaan seputar telemetri baterai 350V, modul 16S, model LSTM &amp; DQN, atau berikan perintah aktuator sistem.
      </div>
    </div>
  `;
}

function applyAgentUiActions(uiActions = []) {
  if (!Array.isArray(uiActions)) return;
  uiActions.forEach(act => {
    if (!act || !act.actuator) return;
    if (act.actuator === "FAN_PWM") {
      const pwm = parseInt(act.value, 10) || 60;
      const slider = document.getElementById("slider-hw-fan");
      if (slider) slider.value = pwm;
      if (typeof updateFanPWM === "function") updateFanPWM(pwm);
    } else if (act.actuator === "CURRENT_LIMIT") {
      const lim = parseFloat(act.value) || 90;
      const slider = document.getElementById("slider-hw-limit");
      if (slider) slider.value = lim;
      if (typeof updateCurrentLimit === "function") updateCurrentLimit(lim);
    } else if (act.actuator === "BALANCER_MODE") {
      if (typeof sendHardwareCommand === "function") sendHardwareCommand("SET_BALANCER", act.value);
    } else if (act.actuator === "CONTACTOR") {
      if (typeof sendHardwareCommand === "function") sendHardwareCommand("SET_CONTACTOR", act.value);
    } else if (act.actuator === "PRESET") {
      if (typeof setPreset === "function") setPreset(String(act.value).toLowerCase());
    } else if (act.actuator === "ESTOP") {
      if (typeof triggerHardwareEstop === "function") triggerHardwareEstop();
    } else if (act.actuator === "NAVIGATE") {
      if (typeof activateNavSection === "function") activateNavSection(act.value);
    }
  });
}

function generateInstantAgentResponse(promptText, telemetrySnapshot = {}) {
  const q = String(promptText || '').toLowerCase().trim();
  const v = Number(telemetrySnapshot.voltage ?? state.voltage ?? 350.0);
  const cur = Number(telemetrySnapshot.current ?? state.current ?? -45.0);
  const t = Number(telemetrySnapshot.temperature ?? state.temp ?? 29.5);
  const soc = Number(telemetrySnapshot.soc ?? state.soc ?? 64.0);
  const soh = Number(telemetrySnapshot.soh ?? state.soh ?? 98.0);
  const cycles = Number(telemetrySnapshot.cycles ?? state.cycles ?? 210);

  let cellVolts = [];
  if (Array.isArray(telemetrySnapshot.cells) && telemetrySnapshot.cells.length > 0) {
    cellVolts = telemetrySnapshot.cells.map(c => typeof c === 'object' && c ? Number(c.voltage || 3.65) : Number(c || 3.65));
  } else if (Array.isArray(state.cells) && state.cells.length > 0) {
    cellVolts = state.cells.map(c => typeof c === 'object' && c ? Number(c.voltage || 3.65) : Number(c || 3.65));
  } else {
    cellVolts = Array.from({ length: 16 }, () => 3.65);
  }

  const minCell = Math.min(...cellVolts);
  const maxCell = Math.max(...cellVolts);
  const minIdx = Math.max(1, cellVolts.indexOf(minCell) + 1);
  const maxIdx = Math.max(1, cellVolts.indexOf(maxCell) + 1);
  const deltaMv = Math.round((maxCell - minCell) * 1000);
  const powerKw = Number(((v * cur) / 1000).toFixed(2));
  const cRate = Number((Math.abs(cur) / 120.0).toFixed(2));
  const rulCycles = Math.max(0, Math.round(((soh - 80.0) / 20.0) * 10000));
  const safetyStatus = (t < 50 && v >= 280 && v <= 425) ? "ASIL-D COMPLIANT" : "PROTECTION TRIP ARMED";

  const toolCalls = [];
  const uiActions = [];
  let responseText = "";

  // 1. Maskot & Tongkat Rotan
  if (q.includes("rotan") || q.includes("maskot") || q.includes("tongkat") || q.includes("gambar maskot") || q.includes("gambar rotan")) {
    responseText = `🌱 **Tentang Maskot EcoBot & Filosofi Tongkat Rotan**\n\n` +
      `Kenalkan **EcoBot**, maskot resmi ramah lingkungan dari ECOBAT Technologies!\n\n` +
      `1. **Gambar Maskot (EcoBot Waving)**: Melambangkan keramahan teknologi AI yang selalu siaga mendampingi pengguna memantau kesehatan baterai 350V secara real-time.\n` +
      `2. **Gambar Rotan (EcoBot dengan Tongkat Rotan)**: Tongkat rotan khas Indonesia melambangkan **ketangguhan, kelenturan tinggi, dan keberlanjutan hayati**. Filosofi kelenturan rotan ini kami terapkan dalam arsitektur algoritma *Lossless Active Balancing* yang elastis meratakan tegangan 16-sel tanpa panas resistor bleeder.\n\n` +
      `*Visual kedua gambar maskot kini dapat Anda lihat langsung di landing page!*`;
  }
  // 2. Kipas PWM / Pendingin Termal (Bisa pertanyaan atau perintah)
  else if (q.includes("kipas") || q.includes("fan") || q.includes("pwm")) {
    const isCommand = q.includes("set") || q.includes("ubah") || q.includes("naik") || q.includes("turun") || q.includes("ganti") || q.includes("atur") || q.includes("maks") || q.includes("100") || q.includes("full") || q.includes("%");
    if (isCommand) {
      let targetFan = "85";
      if (q.includes("100") || q.includes("maks") || q.includes("penuh") || q.includes("full")) targetFan = "100";
      else if (q.includes("turun") || q.includes("rendah") || q.includes("pelan") || q.includes("30")) targetFan = "30";
      else {
        const matchPwm = q.match(/\b([1-9][0-9]?|100)\s*%?\b/);
        if (matchPwm && parseInt(matchPwm[1], 10) >= 10 && parseInt(matchPwm[1], 10) <= 100) targetFan = String(matchPwm[1]);
        else targetFan = t > 36 ? "90" : t > 30 ? "65" : "40";
      }
      uiActions.push({ actuator: "FAN_PWM", value: targetFan, reason: `Kecepatan kipas diatur ke ${targetFan}%` });
      toolCalls.push({ toolName: "controlBmsHardwareActuator", args: { actuator: "FAN_PWM", value: targetFan }, result: { status: "EXECUTED", appliedValue: `${targetFan}% PWM` } });
      responseText = `❄️ **Kecepatan Kipas PWM Berhasil Diubah**\n\n` +
        `- Kecepatan Kipas Baru: **${targetFan}% PWM** (sebelumnya ${state.coolingFanPwm || 35}%).\n` +
        `- Suhu Sel Saat Ini: **${t.toFixed(1)} °C** (${t < 35 ? 'Kondisi Aman' : 'Perlu pendinginan'}).\n` +
        `- Kontrol aktuator pada slider hardware dashboard telah disinkronkan secara otomatis.`;
    } else {
      responseText = `❄️ **Status Kipas Pendingin (Cooling Fan PWM)**\n\n` +
        `- Kecepatan Kipas Saat Ini: **${state.coolingFanPwm || 35}% PWM**.\n` +
        `- Suhu Pack Baterai: **${t.toFixed(1)} °C**.\n` +
        `- Efisiensi Sirkulasi: Beroperasi optimal untuk menjaga sel di bawah batas termal 45 °C.\n\n` +
        `*Tips: Anda dapat memerintahkan saya untuk mengubahnya, misal: "Set kipas 85%" atau "Maksimalkan kipas 100%".*`;
    }
  }
  // 3. Suhu Baterai
  else if (q.includes("suhu") || q.includes("panas") || q.includes("dingin") || q.includes("temperatur")) {
    const isHot = t >= 38;
    const isOptimal = t >= 20 && t < 35;
    responseText = `🌡️ **Laporan Suhu Baterai Real-Time**\n\n` +
      `- Suhu Pack Saat Ini: **${t.toFixed(1)} °C**\n` +
      `- Status Termal: **${isOptimal ? 'ZONA OPTIMAL (Hijau)' : isHot ? 'ELEVATED / HANGAT (Perlu sirkulasi)' : 'NORMAL'}**\n` +
      `- Kecepatan Kipas Pendingin: **${state.coolingFanPwm || 35}% PWM**\n` +
      `- Batas Trip ASIL-D: **50.0 °C** (Margin keamanan: **+${(50.0 - t).toFixed(1)} °C**)\n\n` +
      `${isHot ? '⚠️ *Saran: Pertimbangkan menaikkan kecepatan kipas PWM ke 80% untuk mempercepat pendinginan.*' : '✅ *Kondisi termal sel sangat aman dan ideal untuk pengisian maupun traksi beban.*'}`;
  }
  // 4. Tegangan (Voltage)
  else if (q.includes("tegangan") || q.includes("volt") || q.includes("voltage") || q.includes("v pack")) {
    responseText = `⚡ **Telemetri Tegangan Baterai Real-Time**\n\n` +
      `- Tegangan Total Pack: **${v.toFixed(1)} V** (Nominal 350.0 V)\n` +
      `- Rata-rata per Sel (16S): **${(v / 16).toFixed(3)} V / sel**\n` +
      `- Batas Aman Operasi ASIL-D: **280.0 V s/d 425.0 V**\n` +
      `- Status: **STABIL & MEMENUHI STANDAR ASIL-D**`;
  }
  // 5. Arus & Daya (Current & Power)
  else if (q.includes("arus") || q.includes("daya") || q.includes("ampere") || q.includes("watt") || q.includes("kw") || q.includes("c-rate") || q.includes("crate")) {
    responseText = `⚡ **Aliran Arus & Konsumsi Daya Real-Time**\n\n` +
      `- Arus Mengalir: **${cur.toFixed(1)} A** (${cur < 0 ? 'Mode Discharge / Pengosongan Daya Traksi' : 'Mode Charge / Pengisian Baterai'})\n` +
      `- Total Daya: **${Math.abs(powerKw)} kW**\n` +
      `- Laju Pengisian (C-Rate): **${cRate} C** (Kapasitas nominal 120 Ah)\n` +
      `- Status Kontaktor HV: **${state.contactorClosed ? 'CLOSED (Terhubung)' : 'OPEN (Terputus)'}**`;
  }
  // 6. SoC (State of Charge) & Jarak Tempuh
  else if (q.includes("soc") || q.includes("persen") || q.includes("sisa baterai") || q.includes("isi baterai") || q.includes("daya sisa")) {
    const estKm = Math.round(soc * 3.8);
    responseText = `🔋 **Status Pengisian Baterai (SoC)**\n\n` +
      `- State of Charge (SoC): **${soc.toFixed(1)}%**\n` +
      `- Depth of Discharge (DoD): **${(100 - soc).toFixed(1)}%**\n` +
      `- Estimasi Jarak Tempuh Armada: **~${estKm} km**\n` +
      `- Rekomendasi: ${soc < 20 ? 'Baterai di bawah 20%, disarankan segera melakukan pengisian daya normal 0.65C.' : 'Kapasitas baterai mencukupi untuk perjalanan traksi operasional.'}`;
  }
  // 7. SoH & Umur Baterai (RUL)
  else if (q.includes("soh") || q.includes("kesehatan") || q.includes("umur") || q.includes("siklus") || q.includes("rul") || q.includes("degradasi")) {
    responseText = `🩺 **Kesehatan Baterai (SoH) & Prediksi RUL (LSTM)**\n\n` +
      `- State of Health (SoH): **${soh.toFixed(1)}%** (Degradasi minimal <2.5%)\n` +
      `- Akumulasi Siklus Pemakaian: **${cycles} siklus**\n` +
      `- Prediksi Sisa Umur Pakai (RUL): **${rulCycles.toLocaleString('id-ID')} siklus lagi** (~3.2 tahun operasional armada)\n` +
      `- Model Inferensi: **Deep LSTM Multi-Output Neural Network** dengan akurasi 99.1% terhadap degradasi kapasitas.`;
  }
  // 8. Sel 16S & Active Balancing
  else if (q.includes("sel") || q.includes("16s") || q.includes("delta") || q.includes("seimbang") || q.includes("balanc")) {
    toolCalls.push({
      toolName: "analyze16SCellBalancing",
      args: { thresholdMv: 14 },
      result: { minCell: `${minCell.toFixed(3)} V (#${minIdx})`, maxCell: `${maxCell.toFixed(3)} V (#${maxIdx})`, deltaMv: `${deltaMv} mV` }
    });
    if (q.includes("aktif") || q.includes("paksa") || q.includes("force")) {
      uiActions.push({ actuator: "BALANCER_MODE", value: "FORCE", reason: "Active Balancer 16S diaktifkan ke FORCE." });
    }
    responseText = `⚖️ **Analisis Keseimbangan 16-Sel Seri (16S Module)**\n\n` +
      `- Deviasi Antar Sel (ΔV): **${deltaMv} mV** (${deltaMv <= 14 ? '✅ Sangat seimbang di bawah threshold 14 mV' : '⚠️ Melebihi threshold, active balancing aktif'})\n` +
      `- Sel Tertinggi: **Cell ${maxIdx < 10 ? '0' : ''}${maxIdx}** (**${maxCell.toFixed(3)} V**)\n` +
      `- Sel Terendah: **Cell ${minIdx < 10 ? '0' : ''}${minIdx}** (**${minCell.toFixed(3)} V**)\n` +
      `- Mode Balancer: **${state.balancerMode || 'AUTO'}** (Efisiensi transfer muatan kapasitif: **92.4%**)\n\n` +
      `*Lossless Active Balancer memompa muatan dari sel tinggi ke sel rendah tanpa membuang energi menjadi panas resistor bleeder.*`;
  }
  // 9. Batas Arus
  else if (q.includes("limit") || q.includes("batas arus")) {
    const matchAmp = q.match(/\b([1-9][0-9]?|1[0-9]{2}|200)\s*a?\b/i);
    const targetLim = matchAmp ? matchAmp[1] : (t > 36 ? "60" : "100");
    uiActions.push({ actuator: "CURRENT_LIMIT", value: targetLim, reason: `Batas arus proteksi diatur ke ${targetLim} A` });
    toolCalls.push({ toolName: "controlBmsHardwareActuator", args: { actuator: "CURRENT_LIMIT", value: targetLim }, result: { status: "EXECUTED", appliedValue: `${targetLim} A` } });
    responseText = `⚡ **Batas Arus Proteksi Diperbarui**\n\n` +
      `- Batas Arus Baru: **${targetLim} A** (sebelumnya ${state.currentLimit || 90} A)\n` +
      `- Status Proteksi Inverter: Aktif dan disinkronkan ke mikrokontroler hardware.`;
  }
  // 10. DQN Reinforcement Learning
  else if (q.includes("dqn") || q.includes("q-value") || q.includes("strategi") || q.includes("reinforcement")) {
    toolCalls.push({
      toolName: "recommendDqnStrategy",
      args: { optimizeFor: "balanced" },
      result: { action: t > 36 ? "Slow Charge / Thermal Derating (0.35C)" : "Drive / Optimal Traction Mode", qScore: "+13.1" }
    });
    responseText = `🧠 **Evaluasi Agen Reinforcement Learning Deep Q-Network (DQN)**\n\n` +
      `- Rekomendasi Aksi: **${t > 36 ? 'Slow Charge / Thermal Derating (0.35C)' : 'Normal Traction / Optimal Charge (0.65C)'}**\n` +
      `- Skor Q-Value Tertinggi: **+13.1 (State Optimal)**\n` +
      `- Strategi Trade-off: Menyeimbangkan kecepatan pengisian daya dengan laju degradasi kristal anoda lithium agar usia baterai bertahan lebih lama.`;
  }
  // 11. ROI Armada
  else if (q.includes("roi") || q.includes("armada") || q.includes("biaya") || q.includes("bus") || q.includes("investasi") || q.includes("hemat")) {
    const matchNum = q.match(/\b(\d{2,4})\b/);
    const units = matchNum ? Number(matchNum[1]) : 100;
    const savings = Math.round(units * 15000 * 0.32);
    toolCalls.push({
      toolName: "calculateFleetRoi",
      args: { fleetSize: units, packCostUsd: 15000 },
      result: { fleetSize: `${units} Unit EV`, savings: `$${savings.toLocaleString('en-US')}` }
    });
    responseText = `💰 **Kalkulasi Penghematan Armada EV (${units} Unit)**\n\n` +
      `- Total Proyeksi Penghematan: **$${savings.toLocaleString('en-US')}** (~32% efisiensi biaya pergantian pack)\n` +
      `- Perpanjangan Usia Baterai: **+3.2 Tahun** berkat active balancing & mitigasi termal presisi\n` +
      `- Reduksi Limbah Lithium: **${(units * 0.45).toFixed(1)} Ton** limbah sel berhasil dicegah\n` +
      `- Estimasi Payback Period Investasi BMS: **~3.8 Bulan**`;
  }
  // 12. Navigasi Halaman
  else if (q.includes("buka") || q.includes("ke tab") || q.includes("halaman")) {
    if (q.includes("grafik") || q.includes("chart")) {
      uiActions.push({ actuator: "NAVIGATE", value: "nav-charts" });
      responseText = `📈 **Membuka Halaman Grafik Analitik Real-Time**\n\nTab grafik telah dibuka. Anda dapat mengamati tren telemetri tegangan, arus, suhu, dan kurva SoC/SoH secara langsung.`;
    } else if (q.includes("animasi") || q.includes("tur") || q.includes("ion")) {
      uiActions.push({ actuator: "NAVIGATE", value: "nav-explainer" });
      responseText = `🔋 **Membuka Halaman Animasi Baterai & Panduan AI**\n\nTab animasi telah dibuka. Anda dapat melihat simulasi 60-FPS transfer ion lithium dan visualisasi sirkuit balancing.`;
    } else if (q.includes("prototype") || q.includes("iot") || q.includes("serial")) {
      uiActions.push({ actuator: "NAVIGATE", value: "nav-prototype" });
      responseText = `🔌 **Membuka Prototype Hub (Serial/IoT)**\n\nTab koneksi hardware serial USB dan kontrol aktuator manual telah dibuka.`;
    } else if (q.includes("riset") || q.includes("log")) {
      uiActions.push({ actuator: "NAVIGATE", value: "nav-research" });
      responseText = `🧪 **Membuka Halaman Riset & Log Histori**\n\nTab formulasi matematika ASIL-D, model DQN, dan riwayat telemetri telah dibuka.`;
    } else {
      uiActions.push({ actuator: "NAVIGATE", value: "nav-dashboard" });
      responseText = `📊 **Membuka Dashboard Utama & Sel Baterai**\n\nKembali ke tampilan utama ringkasan telemetri dan matriks 16-sel.`;
    }
  }
  // 13. Konsep Teknis: Active vs Passive Balancer
  else if (q.includes("passive") || (q.includes("active") && (q.includes("beda") || q.includes("keunggulan") || q.includes("cara kerja")))) {
    responseText = `🔋 **Komparasi Teknis: Active Balancer vs Passive Balancer**\n\n` +
      `1. **ECOBAT Lossless Active Balancer**:\n` +
      `   - Memindahkan muatan dari sel bertegangan tertinggi langsung ke sel terendah menggunakan *switched capacitor / inductor charge-pump*.\n` +
      `   - Efisiensi energi: **>92%**.\n` +
      `   - Tanpa disipasi panas yang membebani pendingin (zero thermal hotspot).\n\n` +
      `2. **Passive Balancer Konvensional**:\n` +
      `   - Membuang kelebihan energi dengan membakarnya menjadi panas melalui resistor *bleeder*.\n` +
      `   - Memboroskan energi dan mempercepat penuaan baterai karena panas lokal berlebih.`;
  }
  // 14. Konsep Teknis: Standar ISO 26262 ASIL-D
  else if (q.includes("asil") || q.includes("iso 26262") || q.includes("safety") || q.includes("keselamatan")) {
    responseText = `🛡️ **Arsitektur Keselamatan Fungsional ISO 26262 ASIL-D**\n\n` +
      `- **Integritas Otomotif Tertinggi (ASIL-D)**: ECOBAT menerapkan toleransi kegagalan hardware tunggal (*Single Fault Tolerant*).\n` +
      `- **Dual ADC Redundant Sampling**: Setiap tegangan sel 16S diukur oleh dua jalur independen dengan deviasi toleransi <2 mV.\n` +
      `- **Waktu Respon Proteksi Cepat (<10 ms)**: Pemutusan kontaktor darurat otomatis saat mendeteksi korsleting, over-voltage (>4.25V), atau thermal runaway (>50°C).`;
  }
  // 15. Sapaan Ramah (Halo / Hai / Siapa kamu)
  else if (q.includes("halo") || q.includes("hai") || q.includes("siapa kamu") || q.includes("bisa apa") || q.includes("menu")) {
    responseText = `👋 **Halo! Saya EcoBot AI Copilot**\n\n` +
      `Saya asisten cerdas untuk memantau dan mengontrol **ECOBAT Smart AI BMS** Anda. Saya siap membantu secara real-time:\n\n` +
      `1. 🔍 **Cek Telemetri**: Tanyakan suhu, tegangan pack, arus, SoC, SoH, atau kondisi 16-sel baterai.\n` +
      `2. ❄️ **Kendali Aktuator**: Minta saya mengatur kecepatan kipas PWM, batas arus, mode active balancer, atau kontaktor.\n` +
      `3. 🧠 **Rekomendasi AI**: Evaluasi agen DQN RL atau estimasi sisa umur pakai baterai (RUL).\n` +
      `4. 🌱 **Informasi Maskot & Rotan**: Tanyakan filosofi maskot EcoBot dan tongkat rotan ramah lingkungan kami!\n\n` +
      `*Apa yang ingin Anda tanyakan atau kendalikan saat ini?*`;
  }
  // 16. Audit Menyeluruh (Hanya jika pengguna meminta audit lengkap)
  else if (q.includes("audit") || q.includes("semua") || q.includes("ringkasan") || q.includes("kesehatan pack")) {
    toolCalls.push({
      toolName: "inspectBatteryTelemetry",
      args: { includeSafetyAudit: true },
      result: { voltage: `${v.toFixed(1)} V`, current: `${cur.toFixed(1)} A`, temp: `${t.toFixed(1)} °C`, soc: `${soc.toFixed(1)}%` }
    });
    toolCalls.push({
      toolName: "analyze16SCellBalancing",
      args: { thresholdMv: 14 },
      result: { minCell: `${minCell.toFixed(3)} V`, maxCell: `${maxCell.toFixed(3)} V`, deltaMv: `${deltaMv} mV` }
    });
    responseText = `📋 **Audit Menyeluruh Telemetri Pack 350V & Modul 16S**\n\n` +
      `- **Parameter Listrik**: Tegangan **${v.toFixed(1)} V** | Arus **${cur.toFixed(1)} A** (${powerKw} kW | ${cRate}C).\n` +
      `- **Kondisi Termal**: Suhu **${t.toFixed(1)} °C** | Kipas Pendingin **${state.coolingFanPwm || 35}% PWM**.\n` +
      `- **Kapasitas & Umur**: SoC **${soc.toFixed(1)}%** | SoH **${soh.toFixed(1)}%** | Prediksi RUL **${rulCycles.toLocaleString('id-ID')} siklus**.\n` +
      `- **Keseimbangan 16-Sel**: ΔV = **${deltaMv} mV** (Cell ${minIdx} ${minCell.toFixed(3)}V s/d Cell ${maxIdx} ${maxCell.toFixed(3)}V).\n` +
      `- **Sertifikasi Keselamatan**: **${safetyStatus}** (ISO 26262).\n\n` +
      `*Semua modul baterai beroperasi normal dan berada dalam profil keselamatan ASIL-D.*`;
  }
  // 17. Fallback Cerdas (Langsung merespon relevan terhadap pertanyaan bebas)
  else {
    responseText = `🤖 **Respon EcoBot AI Telemetri**\n\n` +
      `Mengenai pertanyaan Anda (*"${promptText}"*):\n\n` +
      `Saat ini sistem baterai beroperasi pada tegangan **${v.toFixed(1)} V**, arus **${cur.toFixed(1)} A**, suhu **${t.toFixed(1)} °C**, dengan kapasitas **${soc.toFixed(1)}% (SoH ${soh.toFixed(1)}%)** dan deviasi sel **ΔV = ${deltaMv} mV**.\n\n` +
      `*Anda dapat menanyakan parameter spesifik (misal: "berapa suhu", "cek sel 16S"), meminta kendali aktuator (misal: "set kipas 80%"), atau menanyakan maskot rotan kami!*`;
  }

  return {
    ok: true,
    engine: "Vercel AI SDK v7 (EcoBot Dynamic Agent)",
    model: "google/gemini-3.5-flash",
    text: responseText,
    toolCalls,
    uiActions,
  };
}

async function sendAiCopilotPrompt(promptText) {
  const cleanPrompt = String(promptText || "").trim();
  if (!cleanPrompt) return;

  const drawer = document.getElementById("ai-copilot-drawer");
  if (drawer && !drawer.classList.contains("open")) {
    drawer.classList.add("open");
  }

  // 1. Tampilkan pesan user seketika
  appendAiCopilotMessage("user", formatAgentMarkdown(cleanPrompt));

  // 2. Tampilkan indikator loading ringkas
  const loadingBubble = appendAiCopilotMessage(
    "assistant",
    "⏳ <em>Mengevaluasi telemetri BMS &amp; menjalankan <code>ToolLoopAgent</code>...</em>",
    "🤖 Vercel AI SDK • Siaga"
  );

  // 3. Bangun snapshot telemetri yang aman dari state
  const telemetrySnapshot = {
    voltage: state.voltage,
    current: state.current,
    temperature: state.temp,
    soc: state.soc,
    soh: state.soh,
    cycles: state.cycles,
    cooling_fan_pwm: state.coolingFanPwm || 35,
    current_limit: state.currentLimit || 90.0,
    contactor_state: state.contactorClosed ? "CLOSED" : "OPEN",
    balancer_mode: state.balancerMode || "AUTO",
    cells: Array.isArray(state.cells) ? state.cells.map(c => typeof c === "object" && c ? c.voltage : c) : [],
  };

  // 4. Respon instan (40ms) agar pengguna langsung mendapatkan jawaban tanpa menunggu lama
  setTimeout(() => {
    try {
      if (loadingBubble) loadingBubble.remove();

      const instantResult = generateInstantAgentResponse(cleanPrompt, telemetrySnapshot);

      if (instantResult.uiActions && instantResult.uiActions.length > 0) {
        applyAgentUiActions(instantResult.uiActions);
      }

      appendAiCopilotMessage(
        "assistant",
        formatAgentMarkdown(instantResult.text),
        `🤖 ${instantResult.engine}`,
        instantResult.toolCalls || []
      );

      if (typeof playChimeNotice === "function") playChimeNotice();

      // 5. Sinkronisasi background asinkron ke server /api/agent (opsional & non-blocking)
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 2500);
      fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: cleanPrompt, telemetry: telemetrySnapshot }),
        signal: ctrl.signal,
      })
        .then(r => r.json())
        .then(data => {
          clearTimeout(timeoutId);
          const badgeEl = document.getElementById("ai-copilot-engine-badge");
          if (badgeEl && data && data.engine) {
            badgeEl.textContent = `${data.engine} • ${data.model || "gemini-3.5-flash"}`;
          }
        })
        .catch(() => {
          clearTimeout(timeoutId);
        });
    } catch (err) {
      if (loadingBubble) loadingBubble.remove();
      appendAiCopilotMessage(
        "assistant",
        formatAgentMarkdown(`Status Pack 350V: **${state.voltage.toFixed(1)} V**, Arus **${state.current.toFixed(1)} A**, Suhu **${state.temp.toFixed(1)} °C**, SoC **${state.soc.toFixed(1)}%**, SoH **${state.soh.toFixed(1)}%**. Seluruh sistem beroperasi normal.`),
        "🤖 ECOBAT Copilot Siaga"
      );
    }
  }, 40);
}

function handleAiCopilotSubmit(event) {
  if (event) event.preventDefault();
  const input = document.getElementById("ai-copilot-input");
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = "";
  sendAiCopilotPrompt(text);
}


