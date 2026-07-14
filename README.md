# Dual-Axis Solar Tracker
### Real-Time IoT Dashboard with 3D Simulation

> **Roll Numbers:** 2207062, 2207064  
> **Platform:** ESP32 + Blynk IoT + Three.js  
> **Hardware:** 4× Bare LDR · 2× SG90 Servo · INA219 · LM2596 · TP4056 · XL6009 · 2× 18650 Battery (Series)

---

## Table of Contents

- [Project Overview](#-project-overview)
- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Hardware Components](#-hardware-components)
- [Circuit & Wiring](#-circuit--wiring)
- [Complete Pin-by-Pin Wiring](#-complete-pin-by-pin-wiring)
- [Software Setup](#-software-setup)
- [Blynk Configuration](#-blynk-configuration)
- [Project Structure](#-project-structure)
- [How It Works](#-how-it-works)
- [Known Issues & Fixes](#-known-issues--fixes)
- [Future Improvements](#-future-improvements)

---

## Project Overview

This project implements a **dual-axis solar light tracker** that automatically rotates a solar panel to face the brightest light source using 4 LDR (Light Dependent Resistor) sensors arranged in a quadrant grid. The system reads light intensity from each quadrant, compares them, and adjusts two servo motors (pan and tilt axes) to minimize the difference — meaning the panel is always pointing directly at the sun.

All real-time data (voltage, current, power, servo angles, LDR values) is sent to the **Blynk IoT cloud** every second and displayed on a custom web dashboard built with **Three.js** for a live 3D simulation of the tracker's movement.

---

## Features

**Hardware**
- Dual-axis sun tracking (Pan: azimuth left/right · Tilt: elevation up/down)
- 4-quadrant bare LDR array with 10kΩ pull-down voltage dividers
- INA219 sensor wired in series for real voltage, current, and power monitoring
- 2× 18650 battery pack in series (6.0V–8.4V) with percentage calculation
- Full power chain: Solar Panel → LM2596 → TP4056 → Battery → INA219 → XL6009 → ESP32

**Dashboard (SolarDash)**
- Live 3D simulation of the tracker rotating toward the sun in real time
- Real-time metric cards: Voltage · Current · Power · Pan Angle · Tilt Angle · Efficiency
- Sparkline charts for voltage, current, and power history
- Connection status indicator (live / offline)
- **Test Simulator mode** — drag a virtual sun across the 3D scene to test servo logic without physical hardware
- Admin panel with event log
- History page with Chart.js graphs

**Firmware**
- Non-blocking loop using `BlynkTimer` — no `delay()` in main loop
- LDR noise reduction via 5-sample averaging
- Configurable tolerance and step size constants
- `TEST_MODE` flag for Wokwi simulation without real hardware
- Onboard LED indicator: ON while tracking, OFF when locked on sun

---

## System Architecture

```
     WiFi/Blynk      
    ESP32         Blynk Cloud    
  DevKit V1     (virtual pins    
                V1–V9 every 1s      V1–V9)          
                     
                                             REST API
         reads sensors                       poll every 2s
         drives servos             
                                     SolarDash Web   
          Dashboard       
  SENSORS & ACTUATORS              (index.html +   
  4× LDR (GPIO 32–35)               app.js +       
  INA219 (I2C GPIO21/22)            Three.js)      
  Pan Servo  (GPIO18)            
  Tilt Servo (GPIO19)    

```

**Power Flow:**
```
Solar Panel (+12V)
      
   LM2596 (Buck)       12V → 5V
      
   TP4056 (Charger)    charges battery safely
      
   Battery 2×18650     6.0V – 8.4V (series)
      
   INA219 VIN+         ← measures all current here
   INA219 VIN−
      
   XL6009 (Boost)      battery voltage → stable 5V
      
   
ESP32 VIN   Servo VCC ×2   (all on 5V rail)
```

---

## Hardware Components

| # | Component | Specification | Role in Circuit |
|---|---|---|---|
| 1 | **ESP32 DevKit V1** | Xtensa LX6 240MHz, WiFi/BT | Main microcontroller |
| 2 | **SG90 Micro Servo ×2** | 180°, 4.8–6V, 3-wire | Pan axis (GPIO18) + Tilt axis (GPIO19) |
| 3 | **LDR Photoresistor ×4** | GL5528 or equivalent, 5mm | Quadrant light sensing (TL/TR/BL/BR) |
| 4 | **Resistor 10kΩ ×4** | 1/4W, through-hole | Pull-down for each LDR voltage divider |
| 5 | **INA219 Module** | I2C 0x40, 26V/3.2A max | Voltage + current + power monitoring |
| 6 | **Solar Panel** | 12V 1.5W (~125mA short circuit) | Primary energy source |
| 7 | **LM2596 Buck Converter** | Input 4–40V, Output adj, 3A | Steps 12V solar down to 5V for TP4056 |
| 8 | **TP4056 Charger Module** | 4.2V/1A Li-Ion, micro-USB | Charges the 18650 battery safely |
| 9 | **18650 Battery ×2** | 3.7V nominal, ~2500mAh each | Energy storage — wired in **series** |
| 10 | **Battery Holder (2S)** | Side-by-side series holder | Holds both cells, exposes + and − terminals |
| 11 | **XL6009 Boost Converter** | Input 3–32V, Output 5V adj, 4A | Boosts battery (6–8.4V) to stable 5V |

---

## Circuit & Wiring

### Power Chain Overview

```
Solar Panel OUT+  RED   LM2596 IN+
Solar Panel OUT−  BLACK   LM2596 IN−

LM2596 OUT+       RED   TP4056 IN+
LM2596 OUT−       BLACK   TP4056 IN−

TP4056 BAT+ (OUT+) RED   Battery + terminal
TP4056 BAT− (OUT−) BLACK  Battery − terminal

Battery +         RED   INA219 VIN+        ←  MUST go through INA219
INA219 VIN−       ORANGE  XL6009 IN+         ←  series path — critical
Battery −         BLACK   XL6009 IN−

XL6009 OUT+ (5V)  RED   ESP32 VIN
XL6009 OUT+ (5V)  RED   Pan Servo VCC
XL6009 OUT+ (5V)  RED   Tilt Servo VCC
XL6009 OUT− (GND) BLACK   ESP32 GND
XL6009 OUT− (GND) BLACK   Pan Servo GND
XL6009 OUT− (GND) BLACK   Tilt Servo GND
```

### LDR Voltage Divider (repeat for all 4 sensors)

```
ESP32 3.3V
    
  [LDR]        ← bare photoresistor, any orientation
    
     GPIO pin (32 / 33 / 34 / 35)   ← signal wire
    
  [10kΩ]       ← pull-down resistor to GND
    
  GND
```

>  Use **3.3V only — NOT 5V**. GPIO34 and GPIO35 are input-only with no internal pull-up. Each LDR needs its own 10kΩ. All 4 share the same 3.3V and GND rail.

### INA219 Series Connection

```
Battery (+)  INA219 VIN+  INA219 VIN−  XL6009 IN+
Battery (−)  XL6009 IN−
```

>  The INA219 **must be in series**. If XL6009 is wired directly to the battery, current will always read `nan`.

---

## Complete Pin-by-Pin Wiring

### Section 1 — Power Chain

| FROM | PIN | Wire | TO | PIN | Notes |
|---|---|---|---|---|---|
| Solar Panel | OUT+ |  RED | LM2596 | IN+ | 12V positive |
| Solar Panel | OUT− |  BLACK | LM2596 | IN− | 12V negative |
| LM2596 | OUT+ |  RED | TP4056 | IN+ | 5V to charger |
| LM2596 | OUT− |  BLACK | TP4056 | IN− | GND |
| TP4056 | BAT+ |  RED | Battery | + pole | Charge positive |
| TP4056 | BAT− |  BLACK | Battery | − pole | Charge negative |
| Battery | + pole |  RED | INA219 | VIN+ |  MUST go to INA219 first |
| INA219 | VIN− |  ORANGE | XL6009 | IN+ |  critical series path |
| Battery | − pole |  BLACK | XL6009 | IN− | GND direct |
| XL6009 | OUT+ 5V |  RED | ESP32 | VIN | 5V to MCU |
| XL6009 | OUT+ 5V |  RED | Pan Servo | VCC | 5V to servo |
| XL6009 | OUT+ 5V |  RED | Tilt Servo | VCC | 5V to servo |
| XL6009 | OUT− GND |  BLACK | ESP32 | GND | Common GND |
| XL6009 | OUT− GND |  BLACK | Pan Servo | GND | Servo GND |
| XL6009 | OUT− GND |  BLACK | Tilt Servo | GND | Servo GND |

### Section 2 — INA219 Current/Voltage Sensor

| FROM | PIN | Wire | TO | PIN | Notes |
|---|---|---|---|---|---|
| Battery | + pole |  RED | INA219 | VIN+ | Main power IN |
| INA219 | VIN− |  ORANGE | XL6009 | IN+ | Main power OUT |
| ESP32 | 3V3 |  RED | INA219 | VCC | Logic power |
| ESP32 | GND |  BLACK | INA219 | GND | Logic ground |
| ESP32 | GPIO21 |  BLUE | INA219 | SDA | I2C data |
| ESP32 | GPIO22 |  YELLOW | INA219 | SCL | I2C clock |

### Section 3 — 4× Bare LDR Sensors

| FROM | PIN | Wire | TO | PIN | Notes |
|---|---|---|---|---|---|
| ESP32 | 3.3V |  RED | LDR (TL) | Leg 1 | Power to sensor |
| LDR (TL) | Leg 2 |  GREEN | ESP32 | GPIO32 | Signal wire |
| LDR (TL) | Leg 2 (same) |  GREEN | R1 10kΩ | End A | Junction point |
| R1 10kΩ | End B |  BLACK | ESP32 | GND | Pull-down to GND |
| ESP32 | 3.3V |  RED | LDR (TR) | Leg 1 | Power to sensor |
| LDR (TR) | Leg 2 |  BLUE | ESP32 | GPIO33 | Signal wire |
| LDR (TR) | Leg 2 (same) |  BLUE | R2 10kΩ | End A | Junction point |
| R2 10kΩ | End B |  BLACK | ESP32 | GND | Pull-down to GND |
| ESP32 | 3.3V |  RED | LDR (BL) | Leg 1 | Power to sensor |
| LDR (BL) | Leg 2 |  YELLOW | ESP32 | GPIO34 | Input-only pin |
| LDR (BL) | Leg 2 (same) |  YELLOW | R3 10kΩ | End A | Junction point |
| R3 10kΩ | End B |  BLACK | ESP32 | GND | Pull-down to GND |
| ESP32 | 3.3V |  RED | LDR (BR) | Leg 1 | Power to sensor |
| LDR (BR) | Leg 2 |  PURPLE | ESP32 | GPIO35 | Input-only pin |
| LDR (BR) | Leg 2 (same) |  PURPLE | R4 10kΩ | End A | Junction point |
| R4 10kΩ | End B |  BLACK | ESP32 | GND | Pull-down to GND |

### Section 4 — Servo Motors (SG90)

| FROM | PIN | Wire | TO | PIN | Notes |
|---|---|---|---|---|---|
| Pan Servo | VCC (red wire) |  RED | XL6009 | OUT+ 5V | NOT from ESP32 3V3 |
| Pan Servo | GND (brown wire) |  BLACK | XL6009 | OUT− GND | Common ground |
| Pan Servo | SIG (orange wire) |  ORANGE | ESP32 | GPIO18 | PWM signal |
| Tilt Servo | VCC (red wire) |  RED | XL6009 | OUT+ 5V | NOT from ESP32 3V3 |
| Tilt Servo | GND (brown wire) |  BLACK | XL6009 | OUT− GND | Common ground |
| Tilt Servo | SIG (orange wire) |  ORANGE | ESP32 | GPIO19 | PWM signal |

> ℹ SG90 wire colors: **RED** = VCC · **BROWN or BLACK** = GND · **ORANGE or YELLOW** = Signal. Check your specific servo as colors may vary.

### Section 5 — Complete ESP32 GPIO Map

| ESP32 Pin | Wire | Connects To | Notes |
|---|---|---|---|
| `VIN` |  RED | XL6009 OUT+ 5V | Main 5V power in |
| `GND` |  BLACK | XL6009 OUT− GND | Main ground |
| `3V3` |  RED | INA219 VCC | Sensor logic power |
| `3V3` |  RED | LDR Leg-1 ×4 | LDR supply rail (shared) |
| `GND` |  BLACK | INA219 GND | Sensor ground |
| `GND` |  BLACK | R1–R4 End B | Pull-down ground (shared) |
| `GPIO18` |  ORANGE | Pan Servo SIG | PWM pan axis |
| `GPIO19` |  ORANGE | Tilt Servo SIG | PWM tilt axis |
| `GPIO21` |  BLUE | INA219 SDA | I2C data |
| `GPIO22` |  YELLOW | INA219 SCL | I2C clock |
| `GPIO32` |  GREEN | LDR TL Leg-2 + R1 | Top-left light sensor |
| `GPIO33` |  BLUE | LDR TR Leg-2 + R2 | Top-right light sensor |
| `GPIO34` |  YELLOW | LDR BL Leg-2 + R3 | Bottom-left (input-only, no pull-up) |
| `GPIO35` |  PURPLE | LDR BR Leg-2 + R4 | Bottom-right (input-only, no pull-up) |
| `GPIO2` | — | Onboard LED | Tracking indicator (built-in) |

### Section 6 — Build Order (do in this sequence)

| Step | Action | Details |
|---|---|---|
| **1** | Power rails | XL6009 OUT+ → breadboard red rail. XL6009 OUT− → breadboard blue rail. This is your 5V bus. |
| **2** | 3.3V rail | ESP32 3V3 → a separate labeled row. All 4 LDR Leg-1 wires connect here. |
| **3** | Ground rail | ESP32 GND → blue rail. All resistor End-B, INA219 GND, servo GND connect here. |
| **4** | INA219 power | Battery+ → INA219 VIN+. Then INA219 VIN− → XL6009 IN+. Most critical step. |
| **5** | INA219 I2C | GPIO21→SDA · GPIO22→SCL · 3V3→VCC · GND→GND |
| **6** | LDRs one by one | 3V3→LDR Leg1→Leg2→GPIO + 10kΩ→GND. Test each in serial monitor before the next. |
| **7** | Servos | GPIO18→Pan SIG · GPIO19→Tilt SIG · VCC from 5V rail · GND from blue rail |
| **8** | Final check | Multimeter: confirm 5V on red rail, 3.3V on 3V3 row, non-zero shunt voltage on INA219 |

---

## Software Setup

### Prerequisites

- [PlatformIO](https://platformio.org/) (recommended) or Arduino IDE 2.x
- [Wokwi VS Code Extension](https://marketplace.visualstudio.com/items?itemName=wokwi.wokwi-vscode) for simulation
- A [Blynk](https://blynk.io) account (free tier works)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/solar-tracker.git
cd solar-tracker
```

### 2. Install dependencies

PlatformIO handles this automatically on first build. Libraries used:

```ini
lib_deps =
    blynkkk/Blynk@^1.3.2
    madhephaestus/ESP32Servo@^0.12.0
    adafruit/Adafruit INA219@^1.2.1
    adafruit/Adafruit BusIO@^1.14.1
```

### 3. Configure WiFi credentials

Open `src/sketch.ino` and update:

```cpp
char ssid[] = "YourWiFiName";   // ← change this
char pass[] = "YourWiFiPass";   // ← change this
```

### 4. Build and upload

```bash
# Build
pio run

# Upload to ESP32
pio run --target upload

# Monitor serial output
pio device monitor
```

### 5. Open the dashboard

Open `dashboard/index.html` in any modern browser. It connects to Blynk automatically and starts displaying live data.

For offline testing, click **"Enable Test Simulator"** — drag the virtual sun in the 3D scene to test servo tracking without hardware.

---

## Blynk Configuration

**Template ID:** `TMPL6OsUbiBDH`  
**Template Name:** `solar tracker 2207062, 2207064`

### Virtual Pin Mapping

| Virtual Pin | Data | Range | Direction |
|---|---|---|---|
| `V1` | Voltage (V) | 0–20V | ESP32 → Blynk |
| `V2` | Current (mA) | 0–5000mA | ESP32 → Blynk |
| `V3` | Power (mW) | 0–100000mW | ESP32 → Blynk |
| `V4` | Pan Angle (°) | 10–170° | ESP32 → Blynk |
| `V5` | Tilt Angle (°) | 20–160° | ESP32 → Blynk |
| `V6` | LDR Top-Left | 0–4095 | ESP32 → Blynk |
| `V7` | LDR Top-Right | 0–4095 | ESP32 → Blynk |
| `V8` | LDR Bot-Left | 0–4095 | ESP32 → Blynk |
| `V9` | LDR Bot-Right | 0–4095 | ESP32 → Blynk |

### Optional Blynk Mobile Widgets

| Widget | Virtual Pin | Label |
|---|---|---|
| Value Display | V1 | Voltage (V) |
| Value Display | V2 | Current (mA) |
| Value Display | V3 | Power (mW) |
| Gauge | V4 | Pan Angle |
| Gauge | V5 | Tilt Angle |
| SuperChart | V1, V3 | Power History |

---

## Project Structure

```
solar-tracker/

 src/
    sketch.ino              ← ESP32 firmware (tracking logic + Blynk)

 dashboard/
    index.html              ← Main web dashboard (SolarDash)
    app.js                  ← Blynk polling + Three.js 3D scene + charts
    style.css               ← Dark glassmorphic UI theme

 simulation/
    diagram.json            ← Wokwi circuit (potentiometers simulate LDRs)
    wokwi.toml              ← Wokwi project config

 docs/
    circuit_diagram.pdf     ← Full circuit schematic
    wiring_guide.pdf        ← Complete pin-by-pin wiring reference
    blueprint.pdf           ← Cardboard body cutting blueprint (1:1 scale)

 .vscode/
    extensions.json
    launch.json
    settings.json

 platformio.ini              ← PlatformIO build config + library dependencies
 .gitignore
 README.md
```

---

## How It Works

### Sun Tracking Algorithm

The 4 LDRs are placed at the corners of the solar panel face, separated by a physical cross-shaped divider so each only sees its own quadrant:

```

  LDR TL    LDR TR    ← GPIO32, GPIO33

  LDR BL    LDR BR    ← GPIO34, GPIO35

        ↑
  cardboard cross divider
```

Every 150ms the firmware:

1. Reads all 4 LDRs — averaged over 5 samples to reduce ADC noise
2. Computes `avgTop` vs `avgBottom` → drives **tilt servo** up or down
3. Computes `avgLeft` vs `avgRight` → drives **pan servo** left or right
4. Only moves if difference exceeds `TOLERANCE` (150 counts out of 0–4095)
5. Moves by `STEP_SIZE` (3°) per cycle for smooth motion
6. LED goes OFF when all quadrants are balanced → **locked on sun**

### Battery Percentage Calculation

Two 18650 cells in series: min = 6.0V (dead), max = 8.4V (full):

```cpp
float battery = (voltage - 6.0) / (8.4 - 6.0) * 100.0;
battery = constrain(battery, 0, 100);
```

### 3D Dashboard Simulation

The dashboard uses [Three.js](https://threejs.org/) to render a live 3D model of the tracker. The solar panel mesh rotates in real time matching V4 (pan) and V5 (tilt) from Blynk. Four glowing LDR spheres brighten and dim based on V6–V9, showing which quadrant sees the most light and where the virtual sun is positioned.

---

## Known Issues & Fixes

| Problem | Cause | Fix |
|---|---|---|
| `Current: nan` | INA219 not in series — XL6009 wired directly to battery bypassing sensor | Rewire: Battery+ → INA219 VIN+ → INA219 VIN− → XL6009 IN+ |
| `LDR: 0 0 0 0` | Missing 10kΩ pull-down or using 5V instead of 3.3V | Add 10kΩ between each GPIO and GND; verify 3.3V on supply rail |
| `Battery: 100%` | Formula calibrated for 1 cell (4.2V max) not 2 cells (8.4V max) | Use `(voltage - 6.0) / (8.4 - 6.0) * 100` |
| Servo jitter | Tolerance too low for ambient light fluctuation | Increase `TOLERANCE` from 150 to 200–300 |
| Servo wrong direction | Logic polarity mismatch with physical mounting orientation | Swap `++` and `--` in the affected axis block |
| Dashboard not updating | Blynk REST API rate limit exceeded | Keep poll interval at minimum 2000ms |
| INA219 not found | I2C wiring error or wrong SDA/SCL pins | Confirm GPIO21=SDA · GPIO22=SCL · VCC=3.3V · GND=GND |

---

## Future Improvements

- [ ] Replace Blynk polling with WebSocket for sub-200ms real-time updates
- [ ] Laravel + MySQL backend to store and query historical readings
- [ ] Admin panel showing all registered devices and per-device analytics
- [ ] CSV export of voltage/power/angle history for performance analysis
- [ ] RTC module (DS3231) for time-based solar position as tracking fallback
- [ ] OTA (Over-The-Air) firmware updates via WiFi
- [ ] Wind/storm sensor to park the panel in a safe flat position
- [ ] Mobile push notifications when battery drops below 20%
- [ ] Replace bare LDRs with analog LDR modules for cleaner signal

---

## License

This project is submitted as an academic IoT project.  
**Roll Numbers: 2207062, 2207064**

---

## Acknowledgements

- [Blynk IoT Platform](https://blynk.io) — cloud data pipeline and virtual pins
- [Three.js](https://threejs.org) — 3D dashboard rendering engine
- [Adafruit INA219 Library](https://github.com/adafruit/Adafruit_INA219) — current/voltage sensor driver
- [ESP32Servo Library](https://github.com/madhephaestus/ESP32Servo) — servo PWM for ESP32
- [Wokwi Simulator](https://wokwi.com) — circuit simulation and firmware testing
- [PlatformIO](https://platformio.org) — build system and library management
