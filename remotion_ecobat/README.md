# 🎬 ECOBAT Remotion Video & Animation Suite

Proyek ini menggunakan **[Remotion](https://remotion.dev)** (berdasarkan repositori resmi yang telah diunduh di `remotion-repo/`) untuk menghasilkan video animasi resolusi tinggi (1080p 60fps) yang menerangkan cara kerja sistem **ECOBAT Smart AI BMS**.

---

## 🌟 Fitur Animasi Video Remotion

1. **Visualisasi Sel Elektrokimia**: Animasi partikel pergerakan ion lithium ($Li^+$) antara Anoda Grafit dan Katoda melalui separator berpori.
2. **Dinamika Aliran Daya EV**: Aliran daya interaktif dari stasiun pengisian daya (EVSE), melalui kontaktor utama HV, ke sub-modul 16-Sel Seri (16S) dan motor traksi.
3. **Telemetri Real-Time & AI**: Tampilan dinamis estimasi SoC/SoH dari LSTM dan aksi proteksi autonomous dari DQN Reinforcement Learning.

---

## 🚀 Cara Menjalankan & Render Video Remotion

Di direktori `remotion_ecobat/`:

```bash
# 1. Masuk ke direktori
cd remotion_ecobat

# 2. Buka Remotion Video Preview Player di browser
npm run start

# 3. Render video MP4 siap pakai
npm run build
```

Video hasil render akan tersimpan di `remotion_ecobat/out/ecobat_presentation.mp4`.
