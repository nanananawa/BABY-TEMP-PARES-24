// BabyTemp Parent Companion - Application Logic
// ออกแบบสำหรับคุณพ่อคุณแม่และผู้ปกครอง ติดตามไข้ลูกน้อยแบบเรียลไทม์

const DEFAULT_FIREBASE_URL = "https://babytemp-9beab-default-rtdb.asia-southeast1.firebasedatabase.app";
const LOCAL_STORAGE_KEY = "babytemp_parent_state_v1";

let state = {
  baby: {
    name: "น้องพอใจ",
    hn: "HN-00123",
    age: "1 ขวบ 2 เดือน",
    weight: 10.0,
    avatar: "👶",
    deviceId: "baby1"
  },
  activeWorkingSeconds: 15,
  deepSleepMinutes: 5,
  currentTemp: 37.0,
  battery: 95,
  level: "ปกติ",
  lastUpdated: new Date().toISOString(),
  mode: "firebase", // 'firebase' หรือ 'demo'
  firebaseUrl: DEFAULT_FIREBASE_URL,
  alertThreshold: 38.5,
  soundEnabled: true,
  chartRangeHours: 6,
  sensorError: false,
  isOffline: false,
  wakeLockActive: false,
  nextMedDue: null, // Timestamp เมื่อครบ 4 ชม.
  history: [], // [{ time: ISOString, temp: 37.2 }]
  logs: []     // [{ id, type, time, note, medDose, temp }]
};

let chartInstance = null;
let firebaseEventSource = null;
let pollingInterval = null;
let timerTickInterval = null;
let audioCtx = null;
let deferredInstallPrompt = null;
let wakeLockSentinel = null;

// ==========================================
// Initialization & Lifecycle
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  loadState();
  initPwa();
  initChart();
  updateUI();
  calculateParacetamol();
  renderCareLogs();
  renderMeds24h();
  setupAudioAutoUnlock();
  checkAudioStatus();

  // Start connection
  if (state.mode === "firebase") {
    connectFirebase();
  } else {
    enableDemoMode();
  }

  // Start 1-second interval for countdown timer & relative time updates
  timerTickInterval = setInterval(() => {
    updateMedCountdown();
    updateRelativeTime();
  }, 1000);
});

// Load state from localStorage
function loadState() {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.baby) state.baby = { ...state.baby, ...parsed.baby };
      if (parsed.activeWorkingSeconds) state.activeWorkingSeconds = parsed.activeWorkingSeconds;
      if (parsed.deepSleepMinutes) state.deepSleepMinutes = parsed.deepSleepMinutes;
      if (parsed.firebaseUrl) state.firebaseUrl = parsed.firebaseUrl;
      if (parsed.alertThreshold) state.alertThreshold = parsed.alertThreshold;
      if (typeof parsed.soundEnabled !== "undefined") state.soundEnabled = parsed.soundEnabled;
      if (parsed.mode) state.mode = parsed.mode;
      if (parsed.nextMedDue) state.nextMedDue = parsed.nextMedDue;
      if (Array.isArray(parsed.logs)) state.logs = parsed.logs;
      if (Array.isArray(parsed.history) && parsed.history.length > 0) {
        state.history = parsed.history;
      }
    }
  } catch (e) {
    console.warn("Error loading state from localStorage", e);
  }

  // Seed sample history if empty
  if (!state.history || state.history.length === 0) {
    seedSampleHistory();
  }

  // Seed sample log if empty
  if (!state.logs || state.logs.length === 0) {
    seedSampleLogs();
  }

  // Sync inputs with state
  const hnInput = document.getElementById("settingBabyHn");
  if (hnInput) hnInput.value = state.baby.hn || "HN-00123";
  const nameInput = document.getElementById("settingBabyName");
  if (nameInput) nameInput.value = state.baby.name;
  const weightInput = document.getElementById("settingBabyWeight");
  if (weightInput) weightInput.value = state.baby.weight;
  const ageInput = document.getElementById("settingBabyAge");
  if (ageInput) ageInput.value = state.baby.age;
  const avatarSelect = document.getElementById("settingBabyAvatar");
  if (avatarSelect) avatarSelect.value = state.baby.avatar;
  const deviceInput = document.getElementById("settingDeviceId");
  if (deviceInput) deviceInput.value = state.baby.deviceId;
  const modeSelect = document.getElementById("settingMode");
  if (modeSelect) modeSelect.value = state.mode;
  const firebaseUrlInput = document.getElementById("settingFirebaseUrl");
  if (firebaseUrlInput) firebaseUrlInput.value = state.firebaseUrl;
  const alertTempInput = document.getElementById("settingAlertTemp");
  if (alertTempInput) alertTempInput.value = state.alertThreshold;
  const calcWeightInput = document.getElementById("calcWeightInput");
  if (calcWeightInput) calcWeightInput.value = state.baby.weight;

  // Active / Deep Sleep Timing
  const activeInput = document.getElementById("settingActiveSeconds");
  if (activeInput) {
    activeInput.value = state.activeWorkingSeconds || 15;
    const lbl = document.getElementById("valActiveSeconds");
    if (lbl) lbl.textContent = activeInput.value;
  }
  const sleepInput = document.getElementById("settingSleepMinutes");
  if (sleepInput) {
    sleepInput.value = state.deepSleepMinutes || 5;
    const lbl = document.getElementById("valSleepMinutes");
    if (lbl) lbl.textContent = sleepInput.value;
  }
}

function saveState() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      baby: state.baby,
      activeWorkingSeconds: state.activeWorkingSeconds,
      deepSleepMinutes: state.deepSleepMinutes,
      firebaseUrl: state.firebaseUrl,
      alertThreshold: state.alertThreshold,
      soundEnabled: state.soundEnabled,
      mode: state.mode,
      nextMedDue: state.nextMedDue,
      logs: state.logs,
      history: state.history.slice(-100) // Keep latest 100
    }));
  } catch (e) {
    console.warn("Failed to save state", e);
  }
}

// Seed sample data for realistic first impression
function seedSampleHistory() {
  const now = Date.now();
  state.history = [
    { time: new Date(now - 5 * 3600000).toISOString(), temp: 37.1 },
    { time: new Date(now - 4 * 3600000).toISOString(), temp: 37.4 },
    { time: new Date(now - 3 * 3600000).toISOString(), temp: 38.2 },
    { time: new Date(now - 2 * 3600000).toISOString(), temp: 38.6 },
    { time: new Date(now - 1 * 3600000).toISOString(), temp: 37.8 },
    { time: new Date(now - 15 * 60000).toISOString(), temp: 37.2 }
  ];
  state.currentTemp = 37.2;
}

function seedSampleLogs() {
  const now = Date.now();
  state.logs = [
    {
      id: "log-1",
      type: "sponge",
      time: new Date(now - 90 * 60000).toISOString(),
      note: "เช็ดตัวลดไข้ด้วยน้ำอุ่นประมาณ 15 นาที น้องอารมณ์ดีขึ้น",
      temp: 38.6
    },
    {
      id: "log-2",
      type: "med",
      time: new Date(now - 120 * 60000).toISOString(),
      note: "ป้อนยาพาราเซตามอลสูตร 120mg/5ml",
      medDose: "5 มล. (1 ช้อนชา)",
      temp: 38.6
    }
  ];
  // Set next med due 4 hours after log-2
  state.nextMedDue = now - 120 * 60000 + 4 * 3600000;
}

// ==========================================
// UI Updates & Temperature Levels
// ==========================================
function getFeverInfo(temp, sensorError = false) {
  if (sensorError || temp === null || isNaN(temp) || temp <= 0) {
    return {
      level: "ตรวจไม่พบเซนเซอร์ / สายหลุด",
      badgeClass: "error",
      emoji: "🔌",
      title: "🚨 ตรวจไม่พบเซนเซอร์ DS18B20!",
      advice: "สายเซนเซอร์อาจหลุด หลวม หรือชำรุด กรุณาตรวจสอบการต่อสายเซนเซอร์ที่ตัวน้องและบอร์ด ESP32 ทันทีค่ะ"
    };
  } else if (temp < 37.5) {
    return {
      level: "ปกติ",
      badgeClass: "normal",
      emoji: "😊",
      title: "หนูสบายดี อุณหภูมิปกติ",
      advice: "ให้น้องดื่มน้ำหรือนมตามปกติ สวมใส่เสื้อผ้าโปร่งสบาย ระบายอากาศได้ดี หากน้องเริ่มตัวอุ่นให้หมั่นสังเกตอาการค่ะ"
    };
  } else if (temp < 38.5) {
    return {
      level: "ไข้ต่ำ",
      badgeClass: "low",
      emoji: "🥺",
      title: "น้องเริ่มมีไข้ต่ำๆ",
      advice: "ตัวเริ่มอุ่น ควรเช็ดตัวลดไข้ด้วยน้ำอุ่นหรือน้ำอุณหภูมิห้อง (ห้ามใช้น้ำแข็ง) ให้ดื่มน้ำบ่อยๆ และสังเกตอาการอย่างใกล้ชิด"
    };
  } else if (temp < 39.5) {
    return {
      level: "ไข้สูง",
      badgeClass: "high",
      emoji: "🤒",
      title: "น้องมีไข้สูง ควรเช็ดตัวและป้อนยา",
      advice: "ควรเช็ดตัวลดไข้ทันทีประมาณ 10-15 นาที และพิจารณาป้อนยาพาราเซตามอลตามน้ำหนักตัว หากครบ 4 ชม. จากมื้อก่อน"
    };
  } else {
    return {
      level: "วิกฤต",
      badgeClass: "crit",
      emoji: "🚨",
      title: "ไข้สูงวิกฤต ระวังอาการชัก!",
      advice: "อุณหภูมิเกิน 39.5°C เสี่ยงต่ออาการชักจากไข้สูง! รีบเช็ดตัวด้วยน้ำอุ่นทันที ห้ามห่มผ้าหนา หากไข้ไม่ลงหรือมีอาการซึม ให้รีบพาพบแพทย์ทันที"
    };
  }
}

function updateUI() {
  const info = getFeverInfo(state.currentTemp, state.sensorError);

  // 1. Header Baby Bar
  document.getElementById("headerAvatar").textContent = state.baby.avatar || "👶";
  document.getElementById("headerBabyName").textContent = state.baby.name || "น้องผู้ป่วย";
  const hnElem = document.getElementById("headerBabyHn");
  if (hnElem) {
    hnElem.textContent = state.baby.hn ? `HN: ${state.baby.hn}` : "HN: -";
  }
  document.getElementById("headerBabyAge").textContent = state.baby.age ? `อายุ ${state.baby.age}` : "";
  document.getElementById("headerBabyWeight").textContent = state.baby.weight ? `น้ำหนัก ${state.baby.weight} กก.` : "";
  document.getElementById("headerBattery").textContent = `🔋 ${state.battery || 95}%`;

  // 2. Hero Card
  const heroCard = document.getElementById("heroCard");
  heroCard.className = `hero-card ${info.badgeClass}`;
  document.getElementById("heroMoodEmoji").textContent = info.emoji;

  if (state.sensorError) {
    document.getElementById("heroTemp").textContent = "--.-";
  } else {
    document.getElementById("heroTemp").textContent = state.currentTemp.toFixed(1);
  }

  const statusBadge = document.getElementById("heroStatusBadge");
  statusBadge.className = `status-badge ${info.badgeClass}`;
  document.getElementById("heroStatusText").textContent = info.level;

  // 3. Thermometer gauge fill (mapped 35.5 - 40.5)
  if (state.sensorError) {
    document.getElementById("thermoFill").style.width = `0%`;
  } else {
    const minT = 35.5;
    const maxT = 40.5;
    const pct = Math.max(5, Math.min(100, ((state.currentTemp - minT) / (maxT - minT)) * 100));
    document.getElementById("thermoFill").style.width = `${pct}%`;
  }

  // 4. Hero Stats
  const temps = state.history.map(h => h.temp).concat(state.sensorError ? [] : [state.currentTemp]);
  if (temps.length > 0) {
    const max = Math.max(...temps);
    const min = Math.min(...temps);
    document.getElementById("statMaxTemp").textContent = `${max.toFixed(1)}°C`;
    document.getElementById("statMinTemp").textContent = `${min.toFixed(1)}°C`;
  }
  updateRelativeTime();

  // 5. Smart Care Advice Box
  const adviceBox = document.getElementById("adviceBox");
  adviceBox.className = `advice-box ${info.badgeClass}`;
  document.getElementById("adviceTitle").textContent = info.title;
  document.getElementById("adviceDesc").textContent = info.advice;

  // 6. Sound alarm check (Fever high OR Sensor Error)
  if (((state.currentTemp >= state.alertThreshold && !state.sensorError) || state.sensorError) && state.soundEnabled) {
    playAlertTone();
  }

  // 7. Refresh Chart
  if (chartInstance) {
    updateChartData();
  }
}

function updateRelativeTime() {
  const elem = document.getElementById("statLastUpdate");
  if (!elem) return;
  const diffSec = Math.floor((Date.now() - new Date(state.lastUpdated).getTime()) / 1000);
  
  const offlineBanner = document.getElementById("offlineBanner");
  const connPill = document.getElementById("connectionStatusPill");

  if (diffSec > 600 && state.mode === "firebase") {
    state.isOffline = true;
    elem.innerHTML = `<span style="color:#ef4444;font-weight:700;">⚠️ ไม่ตอบสนอง (${Math.floor(diffSec / 60)} นาที)</span>`;
    if (offlineBanner) offlineBanner.style.display = "flex";
    if (connPill) {
      connPill.className = "connection-pill offline";
      document.getElementById("connectionStatusText").textContent = "ออฟไลน์ (>10 นาที)";
    }
  } else {
    state.isOffline = false;
    if (offlineBanner) offlineBanner.style.display = "none";
    if (connPill && state.mode === "firebase" && firebaseEventSource) {
      connPill.className = "connection-pill online";
      document.getElementById("connectionStatusText").textContent = "Live เซนเซอร์";
    }

    if (diffSec < 10) {
      elem.textContent = "เมื่อสักครู่";
    } else if (diffSec < 60) {
      elem.textContent = `${diffSec} วินาทีที่แล้ว`;
    } else if (diffSec < 3600) {
      elem.textContent = `${Math.floor(diffSec / 60)} นาทีที่แล้ว`;
    } else {
      elem.textContent = `${Math.floor(diffSec / 3600)} ชม. ที่แล้ว`;
    }
  }
}

// ==========================================
// Firebase Realtime Connection (SSE & Polling)
// ==========================================
function connectFirebase() {
  if (!state.firebaseUrl) return;

  let cleanUrl = state.firebaseUrl.trim();
  if (cleanUrl.endsWith("/")) cleanUrl = cleanUrl.slice(0, -1);

  const connPill = document.getElementById("connectionStatusPill");
  const connText = document.getElementById("connectionStatusText");
  const demoBanner = document.getElementById("demoBanner");
  demoBanner.style.display = "none";

  connPill.className = "connection-pill";
  connText.textContent = "กำลังเชื่อมต่อ...";

  if (firebaseEventSource) {
    firebaseEventSource.close();
  }

  // Subscribe to babies/{deviceId} or fallback to /babies
  const streamUrl = `${cleanUrl}/babies.json`;

  try {
    firebaseEventSource = new EventSource(streamUrl);

    const handleData = (payload) => {
      if (!payload || !payload.data) return;
      parseFirebasePayload(payload.data);
    };

    firebaseEventSource.addEventListener("put", (e) => {
      try { handleData(JSON.parse(e.data)); } catch (err) {}
    });
    firebaseEventSource.addEventListener("patch", (e) => {
      try { handleData(JSON.parse(e.data)); } catch (err) {}
    });

    firebaseEventSource.onopen = () => {
      connPill.className = "connection-pill online";
      connText.textContent = "Live เซนเซอร์";
      showToast("📡 เชื่อมต่อเซนเซอร์สดเรียบร้อย");
    };

    firebaseEventSource.onerror = () => {
      connPill.className = "connection-pill demo";
      connText.textContent = "โหมดสำรวจ (Polling)";
      startPollingFallback(cleanUrl);
    };
  } catch (e) {
    startPollingFallback(cleanUrl);
  }

  // Also check legacy single baby node
  fetchLegacySingleBaby(cleanUrl);
}

function parseFirebasePayload(data) {
  if (!data || typeof data !== "object") return;

  const dId = state.baby.deviceId || "baby1";
  let target = data[dId] || data;

  if (target && target.current) {
    target = target.current;
  }

  if (target) {
    if (typeof target.battery !== "undefined") {
      state.battery = parseInt(target.battery);
    }
    if (target.name && state.baby.name === "น้องพอใจ") {
      state.baby.name = target.name;
    }

    // ตรวจสอบสถานะเซนเซอร์หลุด / มีปัญหา
    if (target.sensorError === true || target.temp === null || target.temp === -999) {
      state.sensorError = true;
      state.lastUpdated = new Date().toISOString();
      updateUI();
      return;
    }

    if (typeof target.temp !== "undefined") {
      const newTemp = parseFloat(target.temp);
      if (!isNaN(newTemp) && newTemp > 25 && newTemp < 45) {
        state.sensorError = false;
        state.currentTemp = newTemp;
        state.lastUpdated = new Date().toISOString();
        // Push to history
        pushTempHistory(newTemp);
        updateUI();
        saveState();
      }
    }
  }
}

function startPollingFallback(cleanUrl) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    try {
      const dId = state.baby.deviceId || "baby1";
      let res = await fetch(`${cleanUrl}/babies/${dId}/current.json`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.temp !== "undefined") {
          parseFirebasePayload({ [dId]: data });
          return;
        }
      }
      // Check legacy node
      fetchLegacySingleBaby(cleanUrl);
    } catch (e) {
      console.warn("Polling fallback failed", e);
    }
  }, 5000);
}

async function fetchLegacySingleBaby(cleanUrl) {
  try {
    const res = await fetch(`${cleanUrl}/baby/current.json`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.temp !== "undefined") {
        parseFirebasePayload({ [state.baby.deviceId || "baby1"]: data });
      }
    }
  } catch (e) {}
}

function pushTempHistory(t) {
  const now = new Date().toISOString();
  state.history.push({ time: now, temp: t });
  if (state.history.length > 200) {
    state.history = state.history.slice(-200);
  }
}

// ==========================================
// Simulation / Demo Mode
// ==========================================
function enableDemoMode() {
  state.mode = "demo";
  if (firebaseEventSource) firebaseEventSource.close();
  if (pollingInterval) clearInterval(pollingInterval);

  const connPill = document.getElementById("connectionStatusPill");
  const connText = document.getElementById("connectionStatusText");
  const demoBanner = document.getElementById("demoBanner");

  connPill.className = "connection-pill demo";
  connText.textContent = "โหมดจำลอง (Demo)";
  demoBanner.style.display = "flex";
  updateUI();
}

function setMode(newMode) {
  state.mode = newMode;
  saveState();
  if (newMode === "firebase") {
    connectFirebase();
  } else {
    enableDemoMode();
  }
}

function onModeChange(val) {
  setMode(val);
}

function toggleDemoModeModal() {
  document.getElementById("demoTempSlider").value = state.currentTemp;
  document.getElementById("demoSliderVal").textContent = `${state.currentTemp.toFixed(1)}°C`;
  openModal("demoControlModal");
}

function onDemoSliderChange(val) {
  const temp = parseFloat(val);
  document.getElementById("demoSliderVal").textContent = `${temp.toFixed(1)}°C`;
  state.currentTemp = temp;
  state.lastUpdated = new Date().toISOString();
  pushTempHistory(temp);
  updateUI();
  saveState();
}

function setDemoPreset(temp) {
  document.getElementById("demoTempSlider").value = temp;
  onDemoSliderChange(temp);
  closeModal("demoControlModal");
  showToast(`🧪 ปรับอุณหภูมิทดสอบเป็น ${temp.toFixed(1)}°C`);
}

// ==========================================
// Paracetamol Calculator
// ==========================================
function calculateParacetamol() {
  const weightInput = document.getElementById("calcWeightInput");
  const formSelect = document.getElementById("calcFormulation");
  if (!weightInput || !formSelect) return;

  const w = parseFloat(weightInput.value) || 10.0;
  const form = formSelect.value;

  // Standard pediatric dose: 10 - 15 mg/kg per single dose
  const minMg = w * 10;
  const maxMg = w * 15;

  let minMl = 0;
  let maxMl = 0;
  let spoonHint = "";

  if (form === "120") {
    // 120mg / 5ml (24mg/ml)
    minMl = minMg / 24;
    maxMl = maxMg / 24;
  } else if (form === "250") {
    // 250mg / 5ml (50mg/ml)
    minMl = minMg / 50;
    maxMl = maxMg / 50;
  } else if (form === "drop80") {
    // 80mg / 0.8ml (100mg/ml)
    minMl = minMg / 100;
    maxMl = maxMg / 100;
  }

  const avgMl = (minMl + maxMl) / 2;
  const roundedMl = Math.round(avgMl * 2) / 2; // round to nearest 0.5 ml

  // Teaspoon approximation (1 tsp = 5 ml)
  if (form === "drop80") {
    spoonHint = `ประมาณ ${avgMl.toFixed(1)} มล. (ใช้ดรอปเปอร์หยดยาตามขีด)`;
  } else if (avgMl <= 3.0) {
    spoonHint = "ประมาณ 1/2 ช้อนชา (2.5 มล.)";
  } else if (avgMl <= 6.0) {
    spoonHint = "ประมาณ 1 ช้อนชา (5 มล.)";
  } else if (avgMl <= 8.5) {
    spoonHint = "ประมาณ 1 ช้อนชาครึ่ง (7.5 มล.)";
  } else {
    spoonHint = `ประมาณ 2 ช้อนชา (10 มล.) หรือ ${roundedMl.toFixed(1)} ซีซี`;
  }

  const resultElem = document.getElementById("calcResultMl");
  const spoonElem = document.getElementById("calcResultSpoon");
  if (resultElem) resultElem.textContent = `${minMl.toFixed(1)} - ${maxMl.toFixed(1)}`;
  if (spoonElem) spoonElem.textContent = spoonHint;
}

function adjustWeight(delta) {
  const weightInput = document.getElementById("calcWeightInput");
  if (!weightInput) return;
  let current = parseFloat(weightInput.value) || 10.0;
  current = Math.max(2, Math.min(60, current + delta));
  weightInput.value = current.toFixed(1);
  calculateParacetamol();
}

function confirmDoseFromCalculator() {
  const resultText = document.getElementById("calcResultMl").textContent;
  const spoonText = document.getElementById("calcResultSpoon").textContent;
  const doseString = `${resultText} มล. (${spoonText})`;

  // Log medication
  addCareLog("med", new Date().toISOString(), `ป้อนยาพาราเซตามอลคำนวณตามน้ำหนัก ${state.baby.weight} กก.`, doseString);
  startMedTimer();
  showToast("⏰ บันทึกยาเรียบร้อย และเริ่มนับเวลา 4 ชม.");
  switchTab("home");
}

// ==========================================
// 4-Hour Medicine Countdown Timer
// ==========================================
function startMedTimer() {
  const fourHoursMs = 4 * 60 * 60 * 1000;
  state.nextMedDue = Date.now() + fourHoursMs;
  saveState();
  updateMedCountdown();
}

function updateMedCountdown() {
  const titleElem = document.getElementById("medTimerTitle");
  const subElem = document.getElementById("medTimerSub");
  const textElem = document.getElementById("medTimerText");
  const circleElem = document.getElementById("medTimerCircle");
  if (!titleElem || !textElem) return;

  if (!state.nextMedDue) {
    titleElem.textContent = "พร้อมป้อนยาหากมีไข้สูง";
    subElem.textContent = "ยังไม่มีประวัติยาในรอบ 4 ชั่วโมงนี้";
    textElem.textContent = "พร้อม";
    if (circleElem) circleElem.style.strokeDashoffset = "0";
    return;
  }

  const diffMs = state.nextMedDue - Date.now();

  if (diffMs <= 0) {
    titleElem.textContent = "ครบ 4 ชม. แล้ว พร้อมป้อนยาได้";
    subElem.textContent = "หากน้องยังมีไข้สูง สามารถเช็ดตัวหรือป้อนยาตามกำหนดได้";
    textElem.textContent = "พร้อม";
    if (circleElem) circleElem.style.strokeDashoffset = "0";
  } else {
    const totalSec = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    titleElem.textContent = `รอบยาถัดไปอีก: ${hours} ชม. ${minutes} นาที`;
    subElem.textContent = `ห้ามป้อนยาซ้ำก่อนเวลาเพื่อความปลอดภัยของตับ`;
    textElem.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Calculate SVG circle dashoffset (188 is full circumference)
    if (circleElem) {
      const fourHoursSec = 4 * 3600;
      const progress = Math.max(0, Math.min(1, totalSec / fourHoursSec));
      const offset = 188 * (1 - progress);
      circleElem.style.strokeDashoffset = offset;
    }
  }
}

// Render meds list in last 24h
function renderMeds24h() {
  const listElem = document.getElementById("meds24hList");
  if (!listElem) return;

  const now = Date.now();
  const medLogs = state.logs.filter(l => l.type === "med" && (now - new Date(l.time).getTime()) <= 24 * 3600000);

  if (medLogs.length === 0) {
    listElem.innerHTML = `<div style="color: var(--text-muted); text-align: center; padding: 12px;">ยังไม่มีการป้อนยาในรอบ 24 ชั่วโมง</div>`;
    return;
  }

  listElem.innerHTML = medLogs.map((m, idx) => {
    const timeStr = new Date(m.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 8px 12px; border-radius: var(--radius-sm); border-left: 3px solid #ef4444;">
        <div>
          <strong>ครั้งที่ ${idx + 1} (${timeStr} น.)</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${m.medDose || "ยาพาราเซตามอล"}</div>
        </div>
        <span style="font-size: 0.75rem; color: #166534; font-weight: 600;">ไข้ขณะนั้น: ${m.temp ? m.temp.toFixed(1) + '°C' : '-'}</span>
      </div>
    `;
  }).join('');
}

// ==========================================
// Care Logs Management
// ==========================================
function quickLogAction(type) {
  document.getElementById("logType").value = type;
  
  // Format current time HH:MM
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  document.getElementById("logTime").value = `${hours}:${mins}`;

  const medRow = document.getElementById("logMedDetailRow");
  const modalTitle = document.getElementById("quickLogModalTitle");
  const noteInput = document.getElementById("logNote");

  if (type === "med") {
    modalTitle.textContent = "💊 บันทึกการป้อนยา";
    medRow.style.display = "block";
    document.getElementById("logMedDose").value = "5 มล. (1 ช้อนชา)";
    noteInput.value = "ป้อนยาพาราเซตามอลลดไข้";
  } else if (type === "sponge") {
    modalTitle.textContent = "🧽 บันทึกการเช็ดตัวลดไข้";
    medRow.style.display = "none";
    noteInput.value = "เช็ดตัวด้วยน้ำอุ่นประมาณ 15 นาที";
  } else if (type === "milk") {
    modalTitle.textContent = "🍼 บันทึกการให้นม / ดื่มน้ำ";
    medRow.style.display = "none";
    noteInput.value = "ดื่มน้ำ 2 ออนซ์ และดูดนมได้ดี";
  } else {
    modalTitle.textContent = "🩺 บันทึกสังเกตอาการ";
    medRow.style.display = "none";
    noteInput.value = "งอแงเล็กน้อย แต่ยังเล่นได้";
  }

  openModal("quickLogModal");
}

function submitQuickLog(e) {
  e.preventDefault();
  const type = document.getElementById("logType").value;
  const timeStr = document.getElementById("logTime").value;
  const note = document.getElementById("logNote").value;
  const medDose = document.getElementById("logMedDose").value;

  // Build timestamp for today at timeStr
  const [hh, mm] = timeStr.split(":");
  const logDate = new Date();
  logDate.setHours(parseInt(hh), parseInt(mm), 0, 0);

  addCareLog(type, logDate.toISOString(), note, type === "med" ? medDose : null);

  if (type === "med") {
    startMedTimer();
  }

  closeModal("quickLogModal");
  showToast("📝 บันทึกข้อมูลสำเร็จ");
}

function addCareLog(type, timeIso, note, medDose = null) {
  const newLog = {
    id: `log-${Date.now()}`,
    type,
    time: timeIso,
    note,
    medDose,
    temp: state.currentTemp
  };

  state.logs.unshift(newLog);
  saveState();
  renderCareLogs();
  renderMeds24h();
  if (chartInstance) updateChartData();
}

function renderCareLogs(filter = "all") {
  const container = document.getElementById("careLogsTimeline");
  if (!container) return;

  const filtered = state.logs.filter(l => filter === "all" || l.type === filter);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">ไม่มีบันทึกในหมวดหมู่นี้</div>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    let icon = "📝";
    let title = "บันทึก";
    let iconClass = "symptom";

    if (item.type === "med") {
      icon = "💊";
      title = `ป้อนยา ${item.medDose ? `(${item.medDose})` : ''}`;
      iconClass = "med";
    } else if (item.type === "sponge") {
      icon = "🧽";
      title = "เช็ดตัวลดไข้";
      iconClass = "sponge";
    } else if (item.type === "milk") {
      icon = "🍼";
      title = "นม / น้ำ";
      iconClass = "milk";
    } else if (item.type === "symptom") {
      icon = "🩺";
      title = "สังเกตอาการ";
      iconClass = "symptom";
    }

    const timeStr = new Date(item.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(item.time).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

    return `
      <div class="timeline-item">
        <div class="timeline-icon-box ${iconClass}">${icon}</div>
        <div class="timeline-content">
          <div class="timeline-title-row">
            <span class="timeline-title">${title}</span>
            <span class="timeline-time">${dateStr} ${timeStr} น.</span>
          </div>
          <div class="timeline-detail">${item.note || ''}</div>
          ${item.temp ? `<div style="font-size: 0.72rem; color: var(--text-sub); margin-top: 2px;">🌡️ ไข้ขณะนั้น: ${item.temp.toFixed(1)}°C</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function filterLogs(type, btn) {
  document.querySelectorAll("#tab-logs .btn-range-pill").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderCareLogs(type);
}

// ==========================================
// Doctor Report Summary (ส่งรายงานคุณหมอ)
// ==========================================
function openDoctorReportModal() {
  const content = document.getElementById("doctorReportContent");
  if (!content) return;

  const now = Date.now();
  const logs24h = state.logs.filter(l => (now - new Date(l.time).getTime()) <= 24 * 3600000);
  const temps = state.history.map(h => h.temp).concat([state.currentTemp]);
  const maxT = Math.max(...temps).toFixed(1);
  const minT = Math.min(...temps).toFixed(1);

  const medCount = logs24h.filter(l => l.type === "med").length;
  const spongeCount = logs24h.filter(l => l.type === "sponge").length;

  const text = `
📋 รายงานสรุปอาการสำหรับแพทย์ (BabyTemp Doctor Report)
=============================================
👶 ชื่อผู้ป่วยเด็ก: ${state.baby.name}
🏥 รหัสประจำตัว HN: ${state.baby.hn || "ยังไม่ได้ระบุ"}
🎂 อายุ: ${state.baby.age || "-"} | ⚖️ น้ำหนัก: ${state.baby.weight} กก.
🕒 ข้อมูลย้อนหลัง: 24 ชั่วโมง (ณ วันที่ ${new Date().toLocaleDateString('th-TH')} เวลา ${new Date().toLocaleTimeString('th-TH')} น.)

🌡️ สรุปอุณหภูมิ:
- อุณหภูมิปัจจุบัน: ${state.currentTemp.toFixed(1)} °C
- ไข้สูงสุด: ${maxT} °C
- ไข้ต่ำสุด: ${minT} °C

💊 ประวัติการดูแลย้อนหลัง 24 ชม.:
- ป้อนยาลดไข้: ทั้งหมด ${medCount} ครั้ง
- เช็ดตัวลดไข้: ทั้งหมด ${spongeCount} ครั้ง

📝 ลำดับเหตุการณ์บันทึก (Timeline):
${logs24h.map(l => {
  const tStr = new Date(l.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return `• [${tStr} น.] (${l.type.toUpperCase()}) ${l.note || ''} ${l.medDose ? `[${l.medDose}]` : ''} (ไข้: ${l.temp ? l.temp.toFixed(1) + '°C' : '-'})`;
}).join('\n') || 'ไม่มีบันทึกกิจกรรม'}
=============================================
`;

  content.innerText = text;
  openModal("doctorReportModal");
}

function copyDoctorReportText() {
  const content = document.getElementById("doctorReportContent").innerText;
  navigator.clipboard.writeText(content).then(() => {
    showToast("📋 คัดลอกรายงานเรียบร้อยแล้ว ส่งใน LINE ได้ทันที");
  }).catch(() => {
    showToast("คัดลอกไม่สำเร็จ กรุณาลองอีกครั้ง");
  });
}

// ==========================================
// Chart.js Fever Trend Graph
// ==========================================
function initChart() {
  const ctx = document.getElementById("feverTrendChart");
  if (!ctx) return;

  const chartData = prepareChartData();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: [{
        label: 'อุณหภูมิ (°C)',
        data: chartData.temps,
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.1)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#0284c7'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          titleFont: { family: 'Prompt', size: 12 },
          bodyFont: { family: 'Prompt', size: 12 },
          callbacks: {
            label: (ctx) => ` อุณหภูมิ: ${ctx.parsed.y.toFixed(1)} °C`
          }
        }
      },
      scales: {
        y: {
          min: 36.0,
          max: 40.5,
          ticks: {
            stepSize: 0.5,
            font: { family: 'Prompt', size: 10 }
          },
          grid: { color: '#f1f5f9' }
        },
        x: {
          ticks: {
            font: { family: 'Prompt', size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          },
          grid: { display: false }
        }
      }
    }
  });
}

function prepareChartData() {
  const cutoff = Date.now() - state.chartRangeHours * 3600000;
  const filtered = state.history.filter(h => new Date(h.time).getTime() >= cutoff);

  if (filtered.length === 0) {
    return {
      labels: [new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })],
      temps: [state.currentTemp]
    };
  }

  return {
    labels: filtered.map(h => new Date(h.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })),
    temps: filtered.map(h => h.temp)
  };
}

function updateChartData() {
  if (!chartInstance) return;
  const data = prepareChartData();
  chartInstance.data.labels = data.labels;
  chartInstance.data.datasets[0].data = data.temps;
  chartInstance.update();
}

function changeChartRange(hours, btn) {
  state.chartRangeHours = hours;
  document.querySelectorAll(".chart-range-pills .btn-range-pill").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  updateChartData();
}

// ==========================================
// Web Audio Alerts & Notification
// ==========================================
function initAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
}

function playAlertTone() {
  try {
    initAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {
    console.warn("Audio playback failed", e);
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  const btn = document.getElementById("btnSoundToggle");
  const icon = document.getElementById("soundIcon");
  if (state.soundEnabled) {
    btn.classList.add("active");
    icon.textContent = "🔔";
    showToast("🔊 เปิดเสียงเตือนแล้ว");
    unlockAudio();
  } else {
    btn.classList.remove("active");
    icon.textContent = "🔕";
    showToast("🔇 ปิดเสียงเตือนแล้ว");
  }
  saveState();
}

// ==========================================
// Screen Wake Lock API (ค้างหน้าจอเปิดตลอดเวลา)
// ==========================================
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      state.wakeLockActive = true;
      updateWakeLockUI(true);
      wakeLockSentinel.addEventListener('release', () => {
        state.wakeLockActive = false;
        updateWakeLockUI(false);
      });
    } catch (err) {
      console.warn("Wake Lock not granted:", err);
      updateWakeLockUI(false);
    }
  } else {
    showToast("อุปกรณ์นี้ไม่รองรับระบบค้างหน้าจออัตโนมัติ");
  }
}

async function releaseWakeLock() {
  if (wakeLockSentinel !== null) {
    try {
      await wakeLockSentinel.release();
    } catch (e) {}
    wakeLockSentinel = null;
    state.wakeLockActive = false;
    updateWakeLockUI(false);
  }
}

function toggleWakeLock() {
  if (state.wakeLockActive) {
    releaseWakeLock();
    showToast("💡 ปิดโหมดเปิดหน้าจอตลอดเวลาแล้ว");
  } else {
    requestWakeLock();
    showToast("💡 เปิดโหมดหน้าจอตลอดเวลาแล้ว (ป้องกันจอดับตอนนอนเฝ้าไข้)");
  }
}

function updateWakeLockUI(active) {
  const btn = document.getElementById("btnWakeLock");
  if (!btn) return;
  if (active) {
    btn.classList.add("active-glow");
  } else {
    btn.classList.remove("active-glow");
  }
}

document.addEventListener('visibilitychange', async () => {
  if (wakeLockSentinel !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// ==========================================
// Web Audio Unlock Handlers
// ==========================================
function checkAudioStatus() {
  initAudioContext();
  const banner = document.getElementById("audioUnlockBanner");
  if (audioCtx && audioCtx.state === "suspended") {
    if (banner) banner.style.display = "flex";
  } else {
    if (banner) banner.style.display = "none";
  }
}

function unlockAudio() {
  initAudioContext();
  if (audioCtx) {
    audioCtx.resume().then(() => {
      const banner = document.getElementById("audioUnlockBanner");
      if (banner) banner.style.display = "none";
      playAlertTone();
      showToast("🔊 ปลดล็อกระบบเสียงแจ้งเตือนสำเร็จ");
    });
  }
}

function setupAudioAutoUnlock() {
  const handler = () => {
    initAudioContext();
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().then(() => {
        const banner = document.getElementById("audioUnlockBanner");
        if (banner) banner.style.display = "none";
      });
    }
    document.removeEventListener('click', handler);
    document.removeEventListener('touchstart', handler);
  };
  document.addEventListener('click', handler);
  document.addEventListener('touchstart', handler);
}

function requestPushNotificationPermission() {
  if (!("Notification" in window)) {
    alert("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน Notification");
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      new Notification("BabyTemp ผู้ปกครอง", {
        body: "เปิดการแจ้งเตือนอุณหภูมิลูกน้อยสำเร็จเรียบร้อย",
        icon: "icon-192.png"
      });
      showToast("🔔 เปิดการแจ้งเตือนสำเร็จ");
    } else {
      showToast("การแจ้งเตือนถูกปฏิเสธ");
    }
  });
}

// ==========================================
// Settings & Profile Management
// ==========================================
function randomizeParentHn() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  const hnInput = document.getElementById("settingBabyHn");
  if (hnInput) {
    hnInput.value = `HN-${rand}`;
  }
}

async function syncTimingToFirebase() {
  const activeSec = parseInt(document.getElementById("settingActiveSeconds")?.value) || 15;
  const sleepMin = parseFloat(document.getElementById("settingSleepMinutes")?.value) || 5;

  state.activeWorkingSeconds = activeSec;
  state.deepSleepMinutes = sleepMin;
  saveState();

  const firebaseUrl = (state.firebaseUrl || DEFAULT_FIREBASE_URL).replace(/\/+$/, '');
  const deviceId = state.baby.deviceId || 'baby1';

  try {
    showToast("⏳ กำลังซิงก์รอบเวลาไปยัง Firebase...");
    await Promise.all([
      fetch(`${firebaseUrl}/babies/${encodeURIComponent(deviceId)}/activeWorkingSeconds.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeSec),
      }),
      fetch(`${firebaseUrl}/babies/${encodeURIComponent(deviceId)}/deepSleepMinutes.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sleepMin),
      }),
      fetch(`${firebaseUrl}/settings/activeWorkingSeconds.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeSec),
      }),
      fetch(`${firebaseUrl}/settings/deepSleepMinutes.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sleepMin),
      }),
    ]);
    showToast(`✅ ซิงก์สำเร็จ! ทำงาน ${activeSec} วิ • หลับลึก ${sleepMin} นาที`);
  } catch (err) {
    console.error("Failed to sync timing to Firebase", err);
    showToast("⚠️ ไม่สามารถซิงก์ Firebase ได้ โปรดตรวจ URL หรืออินเทอร์เน็ต");
  }
}

function saveParentSettings() {
  const hn = (document.getElementById("settingBabyHn")?.value || "").trim();
  const name = document.getElementById("settingBabyName").value.trim();
  const weight = parseFloat(document.getElementById("settingBabyWeight").value) || 10.0;
  const age = document.getElementById("settingBabyAge").value.trim();
  const avatar = document.getElementById("settingBabyAvatar").value;
  const deviceId = document.getElementById("settingDeviceId").value.trim();
  const firebaseUrl = document.getElementById("settingFirebaseUrl").value.trim();
  const alertTemp = parseFloat(document.getElementById("settingAlertTemp").value) || 38.5;
  const mode = document.getElementById("settingMode").value;

  const activeSec = parseInt(document.getElementById("settingActiveSeconds")?.value) || 15;
  const sleepMin = parseFloat(document.getElementById("settingSleepMinutes")?.value) || 5;

  state.baby.hn = hn || "HN-00123";
  state.baby.name = name || "น้องพอใจ";
  state.baby.weight = weight;
  state.baby.age = age;
  state.baby.avatar = avatar;
  state.baby.deviceId = deviceId || "baby1";
  state.firebaseUrl = firebaseUrl || DEFAULT_FIREBASE_URL;
  state.alertThreshold = alertTemp;
  state.activeWorkingSeconds = activeSec;
  state.deepSleepMinutes = sleepMin;

  // Sync to calculator weight input
  document.getElementById("calcWeightInput").value = weight;
  calculateParacetamol();

  setMode(mode);
  saveState();
  updateUI();

  if (mode === 'firebase') {
    syncTimingToFirebase().catch(() => {});
  }

  showToast("💾 บันทึกการตั้งค่าเรียบร้อยแล้ว");
  switchTab("home");
}

// ==========================================
// Excel & CSV Exports for Parents
// ==========================================
function exportParentExcel() {
  const baby = state.baby;
  const nowStr = new Date().toLocaleString('th-TH');
  const temps = state.history.map(h => h.temp).concat([state.currentTemp]);
  const maxT = Math.max(...temps).toFixed(1);
  const minT = Math.min(...temps).toFixed(1);
  const avgT = (temps.reduce((a, b) => a + b, 0) / (temps.length || 1)).toFixed(1);

  const xmlEscape = (str) => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const rowsTemp = state.history.slice().reverse().map(h => {
    const d = new Date(h.time);
    const dateStr = d.toLocaleDateString('th-TH');
    const timeStr = d.toLocaleTimeString('th-TH');
    const t = Number(h.temp);
    const status = t >= 39.5 ? 'ไข้สูงวิกฤต' : t >= 38.5 ? 'ไข้สูง' : t >= 37.5 ? 'ไข้ต่ำ' : 'ปกติ';
    const styleId = t >= 38.5 ? 'FeverCell' : t >= 37.5 ? 'WatchCell' : 'NormalCell';
    return `
    <Row>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(dateStr)}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(timeStr)}</Data></Cell>
      <Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${t.toFixed(1)}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(status)}</Data></Cell>
    </Row>`;
  }).join('\n');

  const rowsLogs = state.logs.map(l => {
    const d = new Date(l.time);
    const dateStr = d.toLocaleDateString('th-TH');
    const timeStr = d.toLocaleTimeString('th-TH');
    const typeLabel = l.type === 'med' ? 'ป้อนยา' : l.type === 'sponge' ? 'เช็ดตัว' : l.type === 'milk' ? 'นม/น้ำ' : 'สังเกตอาการ';
    return `
    <Row>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(dateStr)}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(timeStr)}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(typeLabel)}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(l.medDose || '-')}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${l.temp ? l.temp.toFixed(1) + ' °C' : '-'}</Data></Cell>
      <Cell ss:StyleID="DataCell"><Data ss:Type="String">${xmlEscape(l.note || '')}</Data></Cell>
    </Row>`;
  }).join('\n');

  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Tahoma" ss:Size="10"/>
  </Style>
  <Style ss:ID="HeaderTitle">
   <Font ss:FontName="Tahoma" ss:Size="14" ss:Bold="1" ss:Color="#0369a1"/>
  </Style>
  <Style ss:ID="MetaLabel">
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#334155"/>
   <Interior ss:Color="#f1f5f9" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="MetaVal">
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Color="#0f172a"/>
  </Style>
  <Style ss:ID="ColHeader">
   <Font ss:FontName="Tahoma" ss:Size="10" ss:Bold="1" ss:Color="#ffffff"/>
   <Interior ss:Color="#0284c7" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center"/>
  </Style>
  <Style ss:ID="DataCell">
   <Alignment ss:Horizontal="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#e2e8f0"/>
   </Borders>
  </Style>
  <Style ss:ID="NormalCell">
   <Alignment ss:Horizontal="Center"/>
   <Font ss:FontName="Tahoma" ss:Bold="1" ss:Color="#15803d"/>
   <Interior ss:Color="#ecfdf5" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="WatchCell">
   <Alignment ss:Horizontal="Center"/>
   <Font ss:FontName="Tahoma" ss:Bold="1" ss:Color="#b45309"/>
   <Interior ss:Color="#fffbeb" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="FeverCell">
   <Alignment ss:Horizontal="Center"/>
   <Font ss:FontName="Tahoma" ss:Bold="1" ss:Color="#b91c1c"/>
   <Interior ss:Color="#fef2f2" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="ประวัติอุณหภูมิ">
  <Table ss:DefaultColumnWidth="120">
   <Column ss:Width="100"/>
   <Column ss:Width="90"/>
   <Column ss:Width="110"/>
   <Column ss:Width="110"/>
   <Row>
    <Cell ss:MergeAcross="3" ss:StyleID="HeaderTitle"><Data ss:Type="String">รายงานบันทึกอุณหภูมิร่างกาย - BabyTemp</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">ชื่อผู้ป่วยเด็ก:</Data></Cell>
    <Cell ss:StyleID="MetaVal"><Data ss:Type="String">${xmlEscape(baby.name)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">รหัสประจำตัว HN:</Data></Cell>
    <Cell ss:StyleID="MetaVal"><Data ss:Type="String">${xmlEscape(baby.hn || '-')}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">อายุ / น้ำหนัก:</Data></Cell>
    <Cell ss:StyleID="MetaVal"><Data ss:Type="String">${xmlEscape(baby.age || '-')} (${baby.weight} กก.)</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">วันที่ส่งออก:</Data></Cell>
    <Cell ss:StyleID="MetaVal"><Data ss:Type="String">${xmlEscape(nowStr)} น.</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">สถิติไข้:</Data></Cell>
    <Cell ss:MergeAcross="2" ss:StyleID="MetaVal"><Data ss:Type="String">สูงสุด: ${maxT}°C | ต่ำสุด: ${minT}°C | เฉลี่ย: ${avgT}°C</Data></Cell>
   </Row>
   <Row></Row>
   <Row>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">วันที่</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">เวลา</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">อุณหภูมิ (°C)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">สถานะ</Data></Cell>
   </Row>
   ${rowsTemp}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="ประวัติการดูแลเด็ก">
  <Table ss:DefaultColumnWidth="120">
   <Column ss:Width="100"/>
   <Column ss:Width="80"/>
   <Column ss:Width="110"/>
   <Column ss:Width="130"/>
   <Column ss:Width="90"/>
   <Column ss:Width="250"/>
   <Row>
    <Cell ss:MergeAcross="5" ss:StyleID="HeaderTitle"><Data ss:Type="String">ประวัติการดูแลและการให้ยาลดไข้</Data></Cell>
   </Row>
   <Row></Row>
   <Row>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">วันที่</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">เวลา</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">กิจกรรม</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">ขนาดยา / ปริมาณ</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">ไข้ขณะนั้น</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">บันทึกเพิ่มเติม</Data></Cell>
   </Row>
   ${rowsLogs || '<Row><Cell ss:MergeAcross="5"><Data ss:Type="String">ไม่มีบันทึก</Data></Cell></Row>'}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (baby.name || 'baby').replace(/[\\/:*?"<>|]/g, '_');
  const safeHn = (baby.hn || 'HN').replace(/[\\/:*?"<>|]/g, '_');
  a.download = `BabyTemp_${safeName}_${safeHn}_Report.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("📊 ส่งออกไฟล์ Excel (.xls) สำเร็จเรียบร้อย");
}

function exportParentCsv() {
  const baby = state.baby;
  const lines = [];
  lines.push(`"รายงานบันทึกสุขภาพเด็ก - BabyTemp"`);
  lines.push(`"ชื่อผู้ป่วยเด็ก","${(baby.name || '').replace(/"/g, '""')}","รหัส HN","${(baby.hn || '').replace(/"/g, '""')}"`);
  lines.push(`"อายุ","${(baby.age || '').replace(/"/g, '""')}","น้ำหนัก (กก.)","${baby.weight || ''}"`);
  lines.push(`"วันที่ส่งออก","${new Date().toLocaleString('th-TH')}"`);
  lines.push('');
  lines.push('"ประเภท","วันที่","เวลา","อุณหภูมิ (°C)","สถานะ/กิจกรรม","ขนาดยา","บันทึกเพิ่มเติม"');

  state.history.slice().reverse().forEach(h => {
    const d = new Date(h.time);
    const t = Number(h.temp);
    const status = t >= 39.5 ? 'ไข้สูงวิกฤต' : t >= 38.5 ? 'ไข้สูง' : t >= 37.5 ? 'ไข้ต่ำ' : 'ปกติ';
    lines.push(`"อุณหภูมิ","${d.toLocaleDateString('th-TH')}","${d.toLocaleTimeString('th-TH')}","${t.toFixed(1)}","${status}","",""`);
  });

  state.logs.forEach(l => {
    const d = new Date(l.time);
    const typeLabel = l.type === 'med' ? 'ป้อนยา' : l.type === 'sponge' ? 'เช็ดตัว' : l.type === 'milk' ? 'นม/น้ำ' : 'สังเกตอาการ';
    lines.push(`"การดูแล","${d.toLocaleDateString('th-TH')}","${d.toLocaleTimeString('th-TH')}","${l.temp ? l.temp.toFixed(1) : ''}","${typeLabel}","${(l.medDose || '').replace(/"/g, '""')}","${(l.note || '').replace(/"/g, '""')}"`);
  });

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (baby.name || 'baby').replace(/[\\/:*?"<>|]/g, '_');
  const safeHn = (baby.hn || 'HN').replace(/[\\/:*?"<>|]/g, '_');
  a.download = `BabyTemp_${safeName}_${safeHn}_Report.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("📥 ส่งออกไฟล์ CSV สำเร็จเรียบร้อย");
}

// ==========================================
// Navigation & Modals
// ==========================================
function switchTab(tabId) {
  // Hide all tabs
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-tab-btn").forEach(el => el.classList.remove("active"));

  // Show target tab
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.add("active");

  // Highlight bottom nav
  const navMap = {
    home: "btnNavHome",
    meds: "btnNavMeds",
    logs: "btnNavLogs",
    guide: "btnNavGuide",
    settings: "btnNavSettings"
  };
  const activeNavBtn = document.getElementById(navMap[tabId]);
  if (activeNavBtn) activeNavBtn.classList.add("active");

  // If switched to chart, trigger resize
  if (tabId === "home" && chartInstance) {
    setTimeout(() => chartInstance.resize(), 50);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("open");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("open");
}

// Toast message
function showToast(msg) {
  const toast = document.getElementById("toastBox");
  const text = document.getElementById("toastText");
  if (!toast || !text) return;
  text.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// ==========================================
// PWA Support
// ==========================================
function initPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(err => {
      console.warn("ServiceWorker registration error", err);
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById("btnInstallPwa");
    if (btn) {
      btn.style.display = "flex";
      btn.onclick = () => {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === "accepted") {
            btn.style.display = "none";
          }
          deferredInstallPrompt = null;
        });
      };
    }
  });
}
