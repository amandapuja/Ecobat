import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const EcobatVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animations
  const titleEntrance = spring({
    frame,
    fps,
    config: { damping: 12 },
  });

  const ionProgress = (frame % 60) / 60;
  const batteryLevel = interpolate(frame, [0, 300], [60, 95]);
  const voltage = interpolate(frame, [0, 300], [345.2, 398.6]);
  const current = interpolate(frame, [0, 150, 300], [45.0, 78.5, 30.0]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#090d16",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 80px",
      }}
    >
      {/* Background Radial Glow */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "20%",
          width: 800,
          height: 800,
          background:
            "radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 60%)",
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: titleEntrance,
          transform: `translateY(${(1 - titleEntrance) * -20}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: "rgba(56, 189, 248, 0.2)",
              border: "2px solid #38bdf8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
            }}
          >
            ⚡
          </div>
          <div>
            <h1 style={{ fontSize: 32, margin: 0, fontWeight: 800 }}>
              ECOBAT <span style={{ color: "#38bdf8" }}>Technologies</span>
            </h1>
            <p style={{ margin: 0, fontSize: 16, color: "#94a3b8" }}>
              Enterprise Smart AI BMS v3.1 & Real-Time Hardware Hub
            </p>
          </div>
        </div>

        <div
          style={{
            padding: "8px 20px",
            borderRadius: 30,
            background: "rgba(74, 222, 128, 0.15)",
            border: "1px solid #4ade80",
            color: "#4ade80",
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          ● LIVE PROTOTYPE SYNC OK
        </div>
      </div>

      {/* Main Showcase Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 50,
          alignItems: "center",
        }}
      >
        {/* Animated Battery Graphic */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.75)",
            border: "2px solid rgba(56, 189, 248, 0.3)",
            borderRadius: 24,
            padding: 40,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
            <span style={{ fontSize: 18, color: "#94a3b8", fontWeight: 600 }}>
              Simulasi Dinamika Aliran Ion Li+
            </span>
            <span style={{ fontSize: 20, color: "#38bdf8", fontWeight: 700 }}>
              {batteryLevel.toFixed(1)}% SoC
            </span>
          </div>

          {/* Battery Shell */}
          <div
            style={{
              position: "relative",
              height: 180,
              borderRadius: 18,
              border: "4px solid rgba(255, 255, 255, 0.2)",
              padding: 10,
              display: "flex",
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.4)",
            }}
          >
            {/* Battery Terminal */}
            <div
              style={{
                position: "absolute",
                right: -20,
                top: "35%",
                width: 14,
                height: "30%",
                backgroundColor: "rgba(255, 255, 255, 0.4)",
                borderRadius: "0 8px 8px 0",
              }}
            />

            {/* Cathode Layer */}
            <div
              style={{
                width: "25%",
                height: "100%",
                background: "rgba(251, 113, 133, 0.3)",
                border: "2px dashed #fb7185",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                color: "#fb7185",
              }}
            >
              KATODA (+)
            </div>

            {/* Electrolyte & Moving Ions */}
            <div
              style={{
                flex: 1,
                height: "100%",
                position: "relative",
                overflow: "hidden",
                margin: "0 10px",
              }}
            >
              {[...Array(12)].map((_, i) => {
                const xPos = ((ionProgress + i / 12) % 1) * 100;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${xPos}%`,
                      top: `${20 + (i % 4) * 20}%`,
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      backgroundColor: "#38bdf8",
                      boxShadow: "0 0 10px #38bdf8",
                    }}
                  />
                );
              })}
            </div>

            {/* Anode Layer */}
            <div
              style={{
                width: "25%",
                height: "100%",
                background: "rgba(74, 222, 128, 0.3)",
                border: "2px dashed #4ade80",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                color: "#4ade80",
              }}
            >
              ANODA (-)
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 20,
              fontFamily: "monospace",
              fontSize: 16,
              color: "#94a3b8",
            }}
          >
            <span>Tegangan: {voltage.toFixed(1)} V</span>
            <span>Arus Pengisian: +{current.toFixed(1)} A</span>
            <span>Suhu Termal: 29.4 °C</span>
          </div>
        </div>

        {/* AI & Feature Highlights */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              background: "rgba(30, 41, 59, 0.7)",
              borderRadius: 18,
              padding: 24,
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            <h3 style={{ margin: 0, color: "#38bdf8", fontSize: 20 }}>
              🤖 AI LSTM Multi-Output
            </h3>
            <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15, lineHeight: 1.5 }}>
              Estimasi State of Charge (SoC), State of Health (SoH) dan RUL secara real-time dengan presisi MAE 0.42%.
            </p>
          </div>

          <div
            style={{
              background: "rgba(30, 41, 59, 0.7)",
              borderRadius: 18,
              padding: 24,
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            <h3 style={{ margin: 0, color: "#4ade80", fontSize: 20 }}>
              ⚖️ 16S Active Balancer
            </h3>
            <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15, lineHeight: 1.5 }}>
              Penyeimbangan tegangan sel otomatis (ΔV &lt; 14 mV) dengan efisiensi transfer muatan induktif.
            </p>
          </div>

          <div
            style={{
              background: "rgba(30, 41, 59, 0.7)",
              borderRadius: 18,
              padding: 24,
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            <h3 style={{ margin: 0, color: "#facc15", fontSize: 20 }}>
              🔌 Hardware Web Serial Bridge
            </h3>
            <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15, lineHeight: 1.5 }}>
              Menyambungkan dashboard secara langsung ke prototipe ESP32/Arduino via USB Serial & REST API.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid rgba(255, 255, 255, 0.1)",
          paddingTop: 20,
          color: "#64748b",
          fontSize: 15,
        }}
      >
        <span>ISO 26262 ASIL-D Functional Safety Compliant</span>
        <span>© 2026 ECOBAT Technologies Ltd. Programmed with Remotion & Canvas.</span>
      </div>
    </AbsoluteFill>
  );
};
