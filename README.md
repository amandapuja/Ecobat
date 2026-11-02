# ⚡ ECOBAT Technologies - Enterprise Smart AI BMS v3.2
## Dedicated Landing Page, Login Portal, & Pastel Hijau-Cream Design Edition

Sistem Manajemen Baterai Cerdas (Smart AI Battery Management System) untuk Kendaraan Listrik (EV) dengan arsitektur multi-view terpadu:
1. **🌐 Halaman Landing Page Khusus**: Halaman beranda elegan dengan hero presentation, spesifikasi nominal 350V, ikhtisar fitur enterprise, dan portal autentikasi peran.
2. **🔐 Portal Login Interaktif & Direct Dashboard Redirect**: Pilihan peran pengguna (Lead Engineer, Operator EV, Peneliti Lab), demo 1-klik masuk langsung ke live telemetri dashboard, serta tombol navigasi cepat kembali dan logout.
3. **🎨 Palet Warna Pastel Hijau (Sage & Matcha) & Cream (Linen & Oat)**: Warna pastel yang menenangkan, estetis, dan modern sesuai standar visual tier-1, dengan dukungan Mode Terang dan Mode Gelap Midnight.
4. **🔋 Animasi Baterai Interaktif 60-FPS & Suite Remotion Video**: Simulasi dinamika ion lithium $Li^+$, aliran elektron sirkuit luar, pendaran termal radiatif, dan panduan edukasi audio-visual terintegrasi.
5. **🔌 Pusat Hub Prototipe Real-Time (Web Serial API & WiFi Gateway)**: Kendali aktuator fisik nyata (kontaktor relay, fan PWM, pembatas arus pengisian, active balancing 16S, dan E-Stop darurat) yang langsung terhubung ke microcontroller ESP32 atau Arduino.

---

## 🌟 Fitur Utama Terbaru (v3.2)

### 0. 🌐 Landing Page & Portal Login Terpadu
- **Dual-View Smooth Transition**: Transisi instan tanpa reload browser antara `#view-landing` dan `#view-dashboard` dengan animasi fade-in yang halus.
- **Role Switcher & Custom Badge**:
  - 👨‍💻 *Lead BMS Engineer* (`amanda.puja@ecobat.ai` - Ir. Amanda Puja)
  - 🚗 *Operator Armada EV* (`budi.santoso@fleet-ecobat.id` - Budi Santoso)
  - 🧪 *Peneliti Lab Baterai* (`hendra.wijaya@lab-ecobat.org` - Dr. Hendra Wijaya)
- **Akses Demo Instan**: Tombol *"Masuk ke Dashboard Real-Time"* untuk pengujian langsung tanpa perlu registrasi manual.
- **Status & Logout Global**: Header dashboard menampilkan badge profil pengguna aktif, tombol navigasi kembali ke Landing Page, serta tombol keluar (logout) yang menyimpan status sesi di `localStorage`.

### 1. 🔋 Animasi Baterai Interaktif 60-FPS & Panduan Remotion
- **Simulasi Dinamika Ion Lithium ($Li^+$)**: Partikel bermuatan $Li^+$ bergerak secara dinamis melintasi elektrolit padat/cair dan membran separator berpori di antara Katoda ($LiFePO_4/NMC$) dan Anoda Grafit. Arah dan kecepatan partikel ion otomatis menyesuaikan arus instan (Discharge ke arah katoda, Charge/Regen ke arah anoda).
- **Aliran Elektron Luar ($e^-$)**: Visualisasi lintasan sirkuit kabel atas yang menampilkan elektron bergerak menuju motor traksi atau stasiun pengisi daya.
- **Pendaran Gradien Termal (Thermal Radiation Glow)**: Warna latar visualizer bereaksi dinamis terhadap suhu sel baterai (Cyan sejuk pada rentang aman 25°C, Amber hangat pada 38°C, dan Coral kemerahan saat mengalami beban panas kritis >48°C).
- **4 Mode Tampilan Interaktif**:
  1. 🔬 *Aliran Ion Li+ & Elektrokimia*: Struktur mikroskopis katoda, separator, dan anoda.
  2. 🔋 *Pack Sub-Modul 16S*: Rangkaian silinder/prismatik 16 sel seri dan busbar tembaga.
  3. 🚗 *Loop Daya Traksi EV*: Diagram powertrain EVSE -> BMS -> Baterai -> Inverter -> Motor EV.
  4. 🧠 *Otak AI & Balancer*: Sinapsis bobot LSTM dan matriks Q-values DQN Reinforcement Learning.
- **Panduan Sinematik Otomatis (Story Tour Walkthrough)**: Tombol *Play/Pause* yang memandu pengguna melalui 4 bab edukasi mengenai arsitektur fisik, aliran energi, estimasi AI, dan penyeimbang aktif.

### 2. 🔌 Pusat Koneksi Prototipe Hardware Real-Time (Hardware Hub)
Website ini dirancang untuk dapat mengatur dan terhubung langsung dengan prototipe fisik di meja kerja Anda:
- **Web Serial API (Direct USB Cable)**:
  - Dukungan langsung Google Chrome, Microsoft Edge, dan Opera untuk menghubungkan kabel USB dari microcontroller (ESP32, Arduino Uno/Mega, STM32, Teensy, Raspberry Pi Pico) langsung ke browser tanpa driver bridge tambahan!
  - Pilihan Baud Rate: **115200 bps (Default ESP32)**, **9600 bps (Arduino)**, **500000 bps (CAN Bus)**, dan **921600 bps**.
  - Deteksi port instan, streaming JSON paket telemetri bolak-balik (bi-directional), serta konsol Serial Monitor interaktif dengan catatan waktu milidetik.
- **WiFi / LAN REST & SSE Gateway**:
  - Prototipe yang terhubung ke jaringan WiFi/LAN dapat mengirim data sensor langsung ke endpoint:
    `POST /api/prototype/telemetry`
  - Prototipe dapat meminta antrean perintah kendali via:
    `GET /api/prototype/command`
- **Emulator / Virtual Hardware Bridge**:
  - Tombol 1-klik untuk mengaktifkan emulator prototipe saat perangkat keras fisik sedang dirakit di lab.

### 3. 🎛️ Konsol Kontrol & Pengaturan Aktuator Prototipe
- **Kontaktor Utama Tegangan Tinggi (HV Main Relay)**:
  - Sakelar toggle untuk menghubungkan (`CLOSED`) atau mengisolasi (`OPEN`) rel daya tegangan tinggi.
  - Dilengkapi indikator fisik LED Glow (Hijau: Aktif, Amber: Terisolasi, Merah Berkedip: E-Stop).
- **PWM Kipas Pendingin (Cooling Fan PWM)**:
  - Slider 0% hingga 100% duty cycle yang mengirim perintah `SET_FAN_PWM` ke pin aktuator perangkat keras (GPIO 18 pada ESP32, 25 kHz).
- **Batas Maksimum Arus Pengisian (Max Current Limit)**:
  - Slider 10A hingga 150A untuk pembatasan arus aman pada charger fisik.
- **Mode Active Balancer**:
  - Tombol seleksi: *Otomatis (ΔV > 14mV)*, *Paksa Seimbangkan Semua Sel*, atau *Nonaktifkan*.
- **Sakelar Darurat Perangkat Keras (Emergency Stop / E-Stop)**:
  - Tombol darurat taktil merah besar yang seketika memutuskan kontaktor utama, menolkan arus, membunyikan alarm suara peringatan, dan menyiarkan sinyal trip darurat ASIL-D ke prototipe.
- **Terminal Perintah Kustom**:
  - Pengiriman perintah langsung (`PING`, `READ_CELLS`, `CALIBRATE_ADC`, dll.) dengan umpan balik ACK real-time.

### 4. 📁 Firmware Siap Flash untuk ESP32 / Arduino
Berkas firmware C++ lengkap telah disediakan di direktori:
`prototype_firmware/ecobat_esp32_firmware.ino`
- Pin 19: Relay Kontaktor Utama
- Pin 18: Kipas Pendingin PWM (25 kHz)
- Pin 21: Transistor Active Balancer Bank
- Pin 4: Input Tombol E-Stop Fisik (Pull-up)
- Pin 34 & 35: ADC Sensor Arus Hall & Suhu Termistor NTC

### 5. 🎬 Remotion Video Suite
Repositori resmi Remotion telah diunduh di `remotion-repo/` dan template video khusus ECOBAT telah disiapkan di `remotion_ecobat/` untuk merender animasi presentasi ke dalam format MP4 (1080p 60fps).

---

## 🚀 Cara Menjalankan

### Cara 1: Menggunakan Server Backend Python (Direkomendasikan)
Server Python telah dilengkapi dengan REST API, Server-Sent Events (SSE), dan endpoint penghubung prototipe:

```bash
# Jalankan server lokal
python server.py
```
Server akan aktif di `http://localhost:8080` dan otomatis membuka browser Anda:
- **Web Dashboard & Hub**: `http://localhost:8080/`
- **REST Status**: `http://localhost:8080/api/status`
- **Telemetry SSE Stream**: `http://localhost:8080/api/stream`
- **Prototype Status API**: `http://localhost:8080/api/prototype/status`
- **Prototype Push Telemetry**: `POST http://localhost:8080/api/prototype/telemetry`
- **Prototype Commands API**: `POST / GET http://localhost:8080/api/prototype/command`

### Cara 2: Standalone Langsung di Browser
Buka file `index.html` langsung di browser mana pun (Chrome, Edge, Firefox, Safari). Seluruh animasi baterai 60-FPS, Web Serial API, simulasi DQN, dan visualisasi sel 16S langsung aktif secara otomatis!

---

## 📁 Struktur Berkas

```
Ecobat/
├── index.html                           # Antarmuka Dashboard, Animasi Baterai & Prototype Hub
├── styles.css                           # Desain Sistem Pastel, Canvas Stages & Terminal Hub
├── app.js                               # Canvas Engine 60-FPS, Web Serial API, Audio & AI Solver
├── server.py                            # Server Python Threaded (REST, SSE & Prototype Bridge)
├── ecobat_ai_bms.py                     # Script Pelatihan Model Deep Learning LSTM & DQN RL
├── prototype_firmware/
│   └── ecobat_esp32_firmware.ino       # Firmware C++ ESP32/Arduino siap pakai
├── remotion_ecobat/                     # Template Remotion Video Generator MP4
│   ├── package.json
│   ├── src/
│   │   ├── EcobatVideo.tsx              # Komposisi Video Remotion
│   │   ├── Root.tsx
│   │   └── index.ts
│   └── README.md
├── remotion-repo/                       # Kloning Repositori Remotion Resmi
└── README.md                            # Dokumentasi Sistem
```

---

© 2026 **ECOBAT Technologies Ltd.** Solusi Cerdas AI BMS Enterprise.
