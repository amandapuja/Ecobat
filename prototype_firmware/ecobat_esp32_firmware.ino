/*
 * ======================================================================================
 * ECOBAT Smart AI BMS - ESP32 / Arduino Hardware Prototype Firmware
 * ======================================================================================
 * Features:
 *  - 16-Cell Li-ion Series (16S) ADC Voltage & Temperature Acquisition
 *  - Bi-Directional USB Web Serial API Communication (115200 bps, JSON Frame)
 *  - High-Voltage Main Contactor Relay Control (Pin 19)
 *  - Active Cell Balancer Transistor Bank (Pin 21)
 *  - Cooling Fan PWM Speed Controller (Pin 18, 25kHz)
 *  - Emergency Stop Fail-Safe (Hardware & Software E-Stop)
 * ======================================================================================
 */

#include <Arduino.h>

// Pin Definitions
#define PIN_CONTACTOR_RELAY  19
#define PIN_COOLING_FAN_PWM  18
#define PIN_ACTIVE_BALANCER  21
#define PIN_ESTOP_INPUT      4
#define PIN_CURRENT_SENSOR   34
#define PIN_TEMP_SENSOR      35

// PWM Fan Configuration
const int PWM_FREQ = 25000;
const int PWM_CHANNEL = 0;
const int PWM_RESOLUTION = 8; // 0 - 255

// BMS Prototype Telemetry State
float pack_voltage = 350.4;
float pack_current = -42.8;
float pack_temp = 29.2;
float soc = 64.8;
float cell_voltages[16];
bool contactor_closed = true;
bool estop_active = false;
int cooling_fan_pwm = 35; // 0 - 100%
String balancer_mode = "AUTO";

unsigned long last_telemetry_time = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 1000;

void setup() {
  Serial.begin(115200);
  
  pinMode(PIN_CONTACTOR_RELAY, OUTPUT);
  pinMode(PIN_ACTIVE_BALANCER, OUTPUT);
  pinMode(PIN_ESTOP_INPUT, INPUT_PULLUP);

  // Configure PWM for Cooling Fan
  ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(PIN_COOLING_FAN_PWM, PWM_CHANNEL);
  ledcWrite(PWM_CHANNEL, map(cooling_fan_pwm, 0, 100, 0, 255));

  digitalWrite(PIN_CONTACTOR_RELAY, HIGH); // Contactor Engaged
  digitalWrite(PIN_ACTIVE_BALANCER, HIGH);

  // Initialize 16 Cell Mock Readings
  for (int i = 0; i < 16; i++) {
    cell_voltages[i] = 3.645 + (i % 4) * 0.003;
  }

  Serial.println("{\"msg\":\"ECOBAT_PROTOTYPE_ONLINE\",\"baud\":115200,\"firmware\":\"v3.1\"}");
}

void parse_incoming_command(String json_str) {
  // Simple JSON command parser for embedded systems
  if (json_str.indexOf("SET_CONTACTOR") >= 0) {
    if (json_str.indexOf("CLOSED") >= 0 || json_str.indexOf("true") >= 0) {
      contactor_closed = true;
      digitalWrite(PIN_CONTACTOR_RELAY, HIGH);
      Serial.println("{\"ack\":\"SET_CONTACTOR\",\"state\":\"CLOSED\"}");
    } else {
      contactor_closed = false;
      digitalWrite(PIN_CONTACTOR_RELAY, LOW);
      Serial.println("{\"ack\":\"SET_CONTACTOR\",\"state\":\"OPEN\"}");
    }
  } else if (json_str.indexOf("SET_FAN_PWM") >= 0) {
    int val_idx = json_str.indexOf("\"value\":");
    if (val_idx >= 0) {
      cooling_fan_pwm = json_str.substring(val_idx + 8).toInt();
      cooling_fan_pwm = constrain(cooling_fan_pwm, 0, 100);
      ledcWrite(PWM_CHANNEL, map(cooling_fan_pwm, 0, 100, 0, 255));
      Serial.print("{\"ack\":\"SET_FAN_PWM\",\"pwm\":");
      Serial.print(cooling_fan_pwm);
      Serial.println("}");
    }
  } else if (json_str.indexOf("TRIGGER_ESTOP") >= 0) {
    estop_active = true;
    contactor_closed = false;
    digitalWrite(PIN_CONTACTOR_RELAY, LOW);
    Serial.println("{\"ack\":\"ESTOP_ACTIVATED\",\"contactor\":\"OPEN\"}");
  } else if (json_str.indexOf("RESET_ESTOP") >= 0) {
    estop_active = false;
    contactor_closed = true;
    digitalWrite(PIN_CONTACTOR_RELAY, HIGH);
    Serial.println("{\"ack\":\"ESTOP_RESET\",\"contactor\":\"CLOSED\"}");
  } else if (json_str.indexOf("PING") >= 0) {
    Serial.println("{\"ack\":\"PONG\",\"uptime_ms\":");
    Serial.print(millis());
    Serial.println("}");
  }
}

void loop() {
  // 1. Process Incoming Serial Commands from Web Serial API
  if (Serial.available()) {
    String cmd_str = Serial.readStringUntil('\n');
    cmd_str.trim();
    if (cmd_str.length() > 0) {
      parse_incoming_command(cmd_str);
    }
  }

  // 2. Hardware E-Stop Button Check
  if (digitalRead(PIN_ESTOP_INPUT) == LOW && !estop_active) {
    estop_active = true;
    contactor_closed = false;
    digitalWrite(PIN_CONTACTOR_RELAY, LOW);
    Serial.println("{\"alert\":\"HARDWARE_ESTOP_TRIPPED\"}");
  }

  // 3. Periodic Telemetry Stream (JSON Frame at 1Hz or faster)
  if (millis() - last_telemetry_time >= TELEMETRY_INTERVAL_MS) {
    last_telemetry_time = millis();

    // In a real build, read analogRead(PIN_CURRENT_SENSOR), etc.
    // Here we update dynamic mock sensor values for demonstration
    if (contactor_closed && !estop_active) {
      soc = max(0.0f, soc - 0.05f);
      pack_current = -42.0 + (random(-20, 20) / 10.0);
    } else {
      pack_current = 0.0;
    }
    pack_voltage = 300.0 + (soc / 100.0) * 100.0;
    pack_temp = 29.0 + (cooling_fan_pwm > 50 ? -0.5 : 0.8);

    // Format Serial JSON Telemetry Packet
    Serial.print("{\"type\":\"TELEMETRY\",\"source\":\"ESP32_HARDWARE\",");
    Serial.print("\"voltage\":"); Serial.print(pack_voltage, 1); Serial.print(",");
    Serial.print("\"current\":"); Serial.print(pack_current, 1); Serial.print(",");
    Serial.print("\"temperature\":"); Serial.print(pack_temp, 1); Serial.print(",");
    Serial.print("\"soc\":"); Serial.print(soc, 1); Serial.print(",");
    Serial.print("\"contactor\":"); Serial.print(contactor_closed ? "\"CLOSED\"" : "\"OPEN\""); Serial.print(",");
    Serial.print("\"fan_pwm\":"); Serial.print(cooling_fan_pwm); Serial.print(",");
    Serial.print("\"estop\":"); Serial.print(estop_active ? "true" : "false"); Serial.print(",");
    
    // Cell Voltages
    Serial.print("\"cells\":[");
    float base_v = pack_voltage / 96.0;
    for (int i = 0; i < 16; i++) {
      float cv = base_v + (random(-10, 10) / 1000.0);
      Serial.print(cv, 3);
      if (i < 15) Serial.print(",");
    }
    Serial.println("]}");
  }
}
