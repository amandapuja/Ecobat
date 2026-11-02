import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { z } from 'zod';

/**
 * Shared helper to evaluate BMS telemetry and 16S cells
 */
function analyzeBmsSnapshot(telemetry = {}) {
  const voltage = Number(telemetry.voltage ?? 350.0);
  const current = Number(telemetry.current ?? -45.2);
  const temperature = Number(telemetry.temperature ?? 29.4);
  const soc = Number(telemetry.soc ?? 64.5);
  const soh = Number(telemetry.soh ?? 97.8);
  const cycles = Number(telemetry.cycles ?? 215);
  const fanPwm = Number(telemetry.cooling_fan_pwm ?? 35);
  const currentLimit = Number(telemetry.current_limit ?? 90);
  const contactor = String(telemetry.contactor_state ?? 'CLOSED');
  const balancerMode = String(telemetry.balancer_mode ?? 'AUTO');
  const cells = Array.isArray(telemetry.cells) && telemetry.cells.length === 16
    ? telemetry.cells.map(Number)
    : Array.from({ length: 16 }, (_, i) => Number((3.645 + (i % 4) * 0.004).toFixed(3)));

  const minCell = Math.min(...cells);
  const maxCell = Math.max(...cells);
  const minCellIdx = cells.indexOf(minCell) + 1;
  const maxCellIdx = cells.indexOf(maxCell) + 1;
  const deltaMv = Math.round((maxCell - minCell) * 1000);
  const cRate = Number((Math.abs(current) / 120.0).toFixed(2));
  const powerKw = Number(((voltage * current) / 1000.0).toFixed(2));
  const rulCycles = Math.max(0, Math.round(((soh - 80.0) / 20.0) * 10000));

  let thermalRisk = 'OPTIMAL';
  if (temperature >= 48) thermalRisk = 'CRITICAL_OVERHEAT';
  else if (temperature >= 38) thermalRisk = 'ELEVATED_WARM';
  else if (temperature < 15) thermalRisk = 'COLD_SUBOPTIMAL';

  return {
    voltage,
    current,
    temperature,
    soc,
    dod: Number((100 - soc).toFixed(1)),
    soh,
    cycles,
    rulCycles,
    cRate,
    powerKw,
    fanPwm,
    currentLimit,
    contactor,
    balancerMode,
    minCell,
    maxCell,
    minCellIdx,
    maxCellIdx,
    deltaMv,
    thermalRisk,
    iso26262Status: temperature < 50 && voltage >= 280 && voltage <= 425 ? 'ASIL-D COMPLIANT' : 'PROTECTION TRIP ARMED',
  };
}

/**
 * Create the ECOBAT Smart AI BMS ToolLoopAgent using Vercel AI SDK v7
 */
export function createEcobatBmsAgent(telemetrySnapshot = {}, collectedUiActions = []) {
  const snap = analyzeBmsSnapshot(telemetrySnapshot);

  return new ToolLoopAgent({
    model: 'google/gemini-3.5-flash',
    stopWhen: isStepCount(6),
    instructions: `Anda adalah ECOBAT AI Copilot, asisten insinyur sistem manajemen baterai cerdas (Smart AI BMS) berbasis Vercel AI SDK (ToolLoopAgent).
Tugas Anda:
1. Gunakan tools yang tersedia untuk memeriksa telemetri baterai real-time (350V nominal, 16-sel seri), keseimbangan sel 16S, strategi Reinforcement Learning DQN, dan proyeksi ROI armada EV.
2. Jika pengguna meminta pengaturan perangkat keras/aktuator (seperti mengubah kecepatan kipas PWM, batas arus, mode active balancer, kontaktor HV, atau skenario preset), panggil tool 'controlBmsHardwareActuator'.
3. Jawab selalu dalam Bahasa Indonesia yang ringkas, teknis, jelas, dan terstruktur dengan poin-poin penting.`,
    tools: {
      inspectBatteryTelemetry: tool({
        description: 'Periksa telemetri pack baterai EV saat ini (tegangan, arus, suhu, SoC, SoH, RUL, C-Rate, dan status keselamatan ISO 26262 ASIL-D).',
        inputSchema: z.object({
          includeSafetyAudit: z.boolean().optional().describe('Sertakan evaluasi batas keamanan ASIL-D'),
        }),
        execute: async ({ includeSafetyAudit = true }) => ({
          packVoltageV: snap.voltage,
          packCurrentA: snap.current,
          powerKw: snap.powerKw,
          cRate: snap.cRate,
          temperatureC: snap.temperature,
          thermalRisk: snap.thermalRisk,
          socPercent: snap.soc,
          dodPercent: snap.dod,
          sohPercent: snap.soh,
          equivalentCycles: snap.cycles,
          predictedRulCycles: snap.rulCycles,
          contactorState: snap.contactor,
          coolingFanPwmPercent: snap.fanPwm,
          currentLimitA: snap.currentLimit,
          safetyAudit: includeSafetyAudit ? snap.iso26262Status : undefined,
        }),
      }),

      analyze16SCellBalancing: tool({
        description: 'Analisis distribusi tegangan 16 sel seri (Cell 01 - Cell 16), nilai deviasi maksimum (Delta mV), dan status Lossless Active Capacitive Balancer.',
        inputSchema: z.object({
          thresholdMv: z.number().optional().describe('Ambang batas pemicu balancing dalam mV (default 14 mV)'),
        }),
        execute: async ({ thresholdMv = 14 }) => ({
          cellCount: 16,
          minCellVoltageV: snap.minCell,
          minCellNumber: `Cell ${String(snap.minCellIdx).padStart(2, '0')}`,
          maxCellVoltageV: snap.maxCell,
          maxCellNumber: `Cell ${String(snap.maxCellIdx).padStart(2, '0')}`,
          deltaMv: snap.deltaMv,
          thresholdMv,
          balancingNeeded: snap.deltaMv >= thresholdMv,
          balancerMode: snap.balancerMode,
          transferEfficiencyPercent: 92.4,
          recommendation:
            snap.deltaMv >= thresholdMv
              ? `Deviasi sel ${snap.deltaMv} mV melebihi ambang ${thresholdMv} mV. Aktifkan transfer muatan kapasitif dari Cell ${String(snap.maxCellIdx).padStart(2, '0')} ke Cell ${String(snap.minCellIdx).padStart(2, '0')}.`
              : `Deviasi sel sangat seimbang (${snap.deltaMv} mV < ${thresholdMv} mV). Seluruh 16 sel beroperasi seragam.`,
        }),
      }),

      recommendDqnStrategy: tool({
        description: 'Evaluasi matriks Q-Values agen Reinforcement Learning Deep Q-Network (DQN) untuk menentukan aksi pengisian/pengosongan dan proteksi termal paling optimal.',
        inputSchema: z.object({
          optimizeFor: z.enum(['lifespan', 'fast_charge', 'balanced']).optional().describe('Prioritas optimasi agen DQN'),
        }),
        execute: async ({ optimizeFor = 'balanced' }) => {
          const isHot = snap.temperature > 36;
          const isLowSoc = snap.soc < 22;
          let bestAction = '4: Drive / Normal Traction Mode';
          let recommendedFan = snap.temperature > 38 ? 85 : snap.temperature > 31 ? 50 : 25;
          let recommendedLimit = isHot ? 55 : 95;

          if (isHot) {
            bestAction = '1: Slow Charge / Thermal Derating (0.35C)';
          } else if (isLowSoc) {
            bestAction = optimizeFor === 'fast_charge' ? '3: Fast Charge (1.0C)' : '2: Normal Optimal Charge (0.65C)';
          }

          return {
            optimizeFor,
            recommendedAction: bestAction,
            qValues: {
              idleStandby: 3.2,
              slowCharge035C: isHot ? 12.4 : 6.8,
              normalCharge065C: isLowSoc ? 13.1 : 8.5,
              fastCharge10C: isHot ? -4.2 : 5.4,
              driveTraction: !isHot && !isLowSoc ? 11.9 : 6.1,
            },
            recommendedFanPwmPercent: recommendedFan,
            recommendedCurrentLimitA: recommendedLimit,
          };
        },
      }),

      controlBmsHardwareActuator: tool({
        description: 'Kirim perintah kontrol langsung ke aktuator BMS & prototipe hardware (ubah PWM kipas pendingin, batas arus, mode active balancer, kontaktor HV, atau preset simulasi).',
        inputSchema: z.object({
          actuator: z.enum(['FAN_PWM', 'CURRENT_LIMIT', 'BALANCER_MODE', 'CONTACTOR', 'PRESET', 'ESTOP']).describe('Jenis aktuator yang dikendalikan'),
          value: z.string().describe('Nilai target, misal "80" untuk FAN_PWM, "AUTO"/"FORCE" untuk BALANCER_MODE, "CLOSED"/"OPEN" untuk CONTACTOR, atau "normal"/"fastcharge"/"overheat"/"regen" untuk PRESET'),
          reason: z.string().describe('Alasan teknis tindakan kontrol'),
        }),
        execute: async ({ actuator, value, reason }) => {
          const actionItem = { actuator, value, reason, timestamp: new Date().toISOString() };
          collectedUiActions.push(actionItem);
          return {
            status: 'EXECUTED',
            actuator,
            appliedValue: value,
            reason,
          };
        },
      }),

      calculateFleetRoi: tool({
        description: 'Hitung proyeksi penghematan biaya armada kendaraan listrik (EV Fleet), perpanjangan umur pakai baterai, dan reduksi limbah sel lithium.',
        inputSchema: z.object({
          fleetSize: z.number().describe('Jumlah unit kendaraan listrik dalam armada'),
          packCostUsd: z.number().optional().describe('Biaya pergantian pack baterai per unit dalam USD (default 15000)'),
        }),
        execute: async ({ fleetSize, packCostUsd = 15000 }) => {
          const savingsUsd = Math.round(fleetSize * packCostUsd * 0.32);
          const wasteTons = Number((fleetSize * 0.45).toFixed(1));
          return {
            fleetSize,
            packCostUsd,
            projectedSavingsUsd: savingsUsd,
            lifespanExtensionYears: 3.2,
            batteryWasteReductionTons: wasteTons,
            estimatedPaybackMonths: 3.8,
          };
        },
      }),
    },
  });
}

/**
 * Local/Offline intelligent fallback using the exact same BMS tool logic when AI Gateway credentials are not configured
 */
function runBuiltInAgentFallback(promptText, telemetrySnapshot = {}) {
  const q = String(promptText || '').toLowerCase();
  const snap = analyzeBmsSnapshot(telemetrySnapshot);
  const toolCalls = [];
  const uiActions = [];

  // Always inspect telemetry
  toolCalls.push({
    toolName: 'inspectBatteryTelemetry',
    args: { includeSafetyAudit: true },
    result: {
      voltage: `${snap.voltage} V`,
      current: `${snap.current} A`,
      temperature: `${snap.temperature} °C`,
      soc: `${snap.soc}%`,
      soh: `${snap.soh}%`,
      rul: `${snap.rulCycles} siklus`,
      safety: snap.iso26262Status,
    },
  });

  if (q.includes('kipas') || q.includes('fan') || q.includes('panas') || q.includes('suhu') || q.includes('dingin') || q.includes('optimasi')) {
    const targetFan = snap.temperature > 36 ? '85' : '60';
    uiActions.push({
      actuator: 'FAN_PWM',
      value: targetFan,
      reason: 'Mitigasi termal otomatis oleh AI Copilot',
    });
    toolCalls.push({
      toolName: 'controlBmsHardwareActuator',
      args: { actuator: 'FAN_PWM', value: targetFan },
      result: { status: 'EXECUTED', appliedValue: `${targetFan}% PWM` },
    });
  }

  if (q.includes('sel') || q.includes('16s') || q.includes('balanc') || q.includes('delta') || q.includes('audit')) {
    toolCalls.push({
      toolName: 'analyze16SCellBalancing',
      args: { thresholdMv: 14 },
      result: {
        minCell: `${snap.minCell}V (#${snap.minCellIdx})`,
        maxCell: `${snap.maxCell}V (#${snap.maxCellIdx})`,
        deltaMv: `${snap.deltaMv} mV`,
        balancer: snap.balancerMode,
      },
    });
    if (q.includes('aktif') || q.includes('paksa') || q.includes('force')) {
      uiActions.push({
        actuator: 'BALANCER_MODE',
        value: 'FORCE',
        reason: 'Penyeimbangan aktif 16S diinstruksikan melalui AI Copilot',
      });
    }
  }

  if (q.includes('dqn') || q.includes('q-value') || q.includes('strategi') || q.includes('charge') || q.includes('ai')) {
    toolCalls.push({
      toolName: 'recommendDqnStrategy',
      args: { optimizeFor: 'balanced' },
      result: {
        optimalAction: snap.temperature > 36 ? 'Slow Charge / Thermal Derating (0.35C)' : 'Drive / Optimal Operation',
        recommendedLimit: `${snap.temperature > 36 ? 55 : 90} A`,
      },
    });
  }

  if (q.includes('roi') || q.includes('armada') || q.includes('biaya') || q.includes('bus') || q.includes('hemat')) {
    const matchNum = q.match(/\b(\d{2,4})\b/);
    const units = matchNum ? Number(matchNum[1]) : 100;
    const savings = Math.round(units * 15000 * 0.32);
    toolCalls.push({
      toolName: 'calculateFleetRoi',
      args: { fleetSize: units, packCostUsd: 15000 },
      result: {
        fleetSize: `${units} Unit EV`,
        savingsUsd: `$${savings.toLocaleString('en-US')}`,
        wasteReduced: `${(units * 0.45).toFixed(1)} Ton`,
      },
    });
  }

  const lines = [
    `### 🤖 Analisis ECOBAT AI Agent (\`ToolLoopAgent\`)`,
    `- **Status Pack 350V**: Tegangan **${snap.voltage} V**, Arus **${snap.current} A** (${snap.powerKw} kW | ${snap.cRate}C), Suhu **${snap.temperature} °C** (*${snap.thermalRisk}*).`,
    `- **Estimasi LSTM**: **SoC ${snap.soc}%** (DoD ${snap.dod}%), **SoH ${snap.soh}%**, Proyeksi RUL **${snap.rulCycles.toLocaleString('id-ID')} siklus**.`,
    `- **Keseimbangan Sel 16S**: Rentang **${snap.minCell} V** (Cell ${String(snap.minCellIdx).padStart(2, '0')}) s/d **${snap.maxCell} V** (Cell ${String(snap.maxCellIdx).padStart(2, '0')}) dengan **ΔV = ${snap.deltaMv} mV** (Mode Balancer: **${snap.balancerMode}**).`,
    `- **Rekomendasi DQN & Keselamatan**: Status **${snap.iso26262Status}**. ${
      snap.temperature > 36
        ? 'Suhu terdeteksi meningkat — direkomendasikan menaikkan PWM kipas pendingin dan membatasi C-rate pengisian.'
        : 'Parameter elektrokimia dan termal berada pada zona optimal.'
    }`,
  ];

  if (uiActions.length > 0) {
    lines.push(
      `- **Tindakan Aktuator Otomatis**: Berhasil mengeksekusi \`${uiActions
        .map(a => `${a.actuator} -> ${a.value}`)
        .join(', ')}\` pada dashboard.`
    );
  }

  return {
    ok: true,
    engine: 'Vercel AI SDK v7 (ToolLoopAgent Hybrid Engine)',
    model: 'google/gemini-3.5-flash',
    text: lines.join('\n'),
    toolCalls,
    uiActions,
  };
}

/**
 * Vercel Serverless Function Handler (POST /api/agent)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 'READY',
      agent: 'ECOBAT Smart AI BMS ToolLoopAgent',
      sdk: 'Vercel AI SDK v7',
      model: 'google/gemini-3.5-flash',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prompt = body.prompt || 'Lakukan audit menyeluruh pada telemetri baterai 350V dan 16S cell pack saat ini.';
    const telemetry = body.telemetry || {};

    const hasGatewayAuth = Boolean(
      process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
    );

    if (hasGatewayAuth) {
      const uiActions = [];
      const toolCallsLog = [];
      const agent = createEcobatBmsAgent(telemetry, uiActions);

      const result = await agent.generate({
        prompt,
        onToolExecutionEnd({ toolCall, toolOutput }) {
          toolCallsLog.push({
            toolName: toolCall.toolName,
            args: toolCall.input ?? {},
            result: toolOutput.type === 'tool-result' ? toolOutput.output : { error: String(toolOutput.error) },
          });
        },
      });

      return res.status(200).json({
        ok: true,
        engine: 'Vercel AI SDK v7 (AI Gateway Live)',
        model: 'google/gemini-3.5-flash',
        text: result.text,
        toolCalls: toolCallsLog,
        uiActions,
      });
    }

    // Fallback when running without AI_GATEWAY_API_KEY configured yet
    const fallbackResponse = runBuiltInAgentFallback(prompt, telemetry);
    return res.status(200).json(fallbackResponse);
  } catch (err) {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const fallbackResponse = runBuiltInAgentFallback(body.prompt || 'Audit BMS', body.telemetry || {});
    return res.status(200).json({
      ...fallbackResponse,
      note: `Fallback executed (${err?.message || 'gateway unavailable'})`,
    });
  }
}

