#define BLYNK_TEMPLATE_ID "TMPL6OsUbiBDH"
#define BLYNK_TEMPLATE_NAME "solar tracker 2207062"
#define BLYNK_AUTH_TOKEN "CHDVXJCB7iVixAtAXsoaScjUG6KCl0ei"

#define BLYNK_PRINT Serial

#include <WiFi.h>
#include <WiFiClient.h>
#include <BlynkSimpleEsp32.h>
#include <Wire.h>
#include <ESP32Servo.h>
#include <Adafruit_INA219.h>

// ---> ENTER YOUR 2.4GHz WI-FI HERE <---
char auth[] = BLYNK_AUTH_TOKEN;
char ssid[] = "LSH_New_403"; 
char pass[] = "14545818";

Adafruit_INA219 ina219;
Servo panServo;
Servo tiltServo;
BlynkTimer timer;

// -------- LDR Pins --------
const int TL_PIN = 32;
const int TR_PIN = 33;
const int BL_PIN = 34;
const int BR_PIN = 35;

// -------- Servo Pins --------
const int PAN_SERVO = 18;
const int TILT_SERVO = 19;

int panPos = 90;
int tiltPos = 90;
int tolerance = 30;

// Readings
int tl, tr, bl, br;
float voltage, current, power, battery;

void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);

  panServo.setPeriodHertz(50);
  tiltServo.setPeriodHertz(50);

  panServo.attach(PAN_SERVO, 500, 2400);
  tiltServo.attach(TILT_SERVO, 500, 2400);

  panServo.write(panPos);
  tiltServo.write(tiltPos);

  if (!ina219.begin()) {
    Serial.println("INA219 NOT FOUND!");
  } else {
    ina219.setCalibration_32V_2A(); 
    Serial.println("INA219 OK");
  }

  Serial.println("Solar Tracker Started");

  // Non-blocking Wi-Fi setup
  WiFi.begin(ssid, pass);
  Blynk.config(auth);

  timer.setInterval(50L, updateTracker);      // Run servos every 50ms
  timer.setInterval(1000L, sendSensorData);   // Read sensors & send to Blynk every 1s
}

void updateTracker() {
  tl = analogRead(TL_PIN);
  tr = analogRead(TR_PIN);
  bl = analogRead(BL_PIN);
  br = analogRead(BR_PIN);

  int top = (tl + tr) / 2;
  int bottom = (bl + br) / 2;
  int left = (tl + bl) / 2;
  int right = (tr + br) / 2;

  if (abs(top - bottom) > tolerance) {
    if (top > bottom) tiltPos++;
    else tiltPos--;
    tiltPos = constrain(tiltPos, 20, 160);
    tiltServo.write(tiltPos);
  }

  if (abs(left - right) > tolerance) {
    if (left > right) panPos--;
    else panPos++;
    panPos = constrain(panPos, 10, 170);
    panServo.write(panPos);
  }
}

void sendSensorData() {
  voltage = ina219.getBusVoltage_V();
  current = ina219.getCurrent_mA();
  power = ina219.getPower_mW();

  if (isnan(current)) current = 0; // Double-check fallback

  battery = (voltage - 6.0) / (8.4 - 6.0) * 100.0;
  battery = constrain(battery, 0, 100);

  // Print to Serial Monitor
  Serial.println("--------------------------------");
  Serial.print("TL : "); Serial.print(tl); Serial.print("   TR : "); Serial.print(tr);
  Serial.print("   BL : "); Serial.print(bl); Serial.print("   BR : "); Serial.println(br);
  Serial.print("Pan : "); Serial.print(panPos); Serial.print("   Tilt : "); Serial.println(tiltPos);
  Serial.print("Voltage : "); Serial.print(voltage); Serial.println(" V");
  Serial.print("Current : "); Serial.print(current); Serial.println(" mA");
  Serial.print("Power : "); Serial.print(power); Serial.println(" mW");
  Serial.print("Battery : "); Serial.print(battery); Serial.println("%");

  // Send to Blynk (Only executes if Wi-Fi is successfully connected)
  if (Blynk.connected()) {
    Blynk.virtualWrite(V1, voltage);
    Blynk.virtualWrite(V2, current);
    Blynk.virtualWrite(V3, power);
    Blynk.virtualWrite(V4, panPos);
    Blynk.virtualWrite(V5, tiltPos);
    Blynk.virtualWrite(V6, tl);
    Blynk.virtualWrite(V7, tr);
    Blynk.virtualWrite(V8, bl);
    Blynk.virtualWrite(V9, br);
  }
}

void loop() {
  // Keep Blynk connected in the background non-blockingly
  if (WiFi.status() == WL_CONNECTED) {
    Blynk.run();
  }
  
  // Run our scheduled timers (Servos and Sensor reading)
  timer.run();
}