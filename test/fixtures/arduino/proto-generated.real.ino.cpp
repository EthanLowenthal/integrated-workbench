#include <Arduino.h>
#line 1 "<SKETCH>/Proto.ino"
#include <Servo.h>

struct Reading {
  int value;
};

Servo servo;

#line 9 "<SKETCH>/Proto.ino"
void setup();
#line 16 "<SKETCH>/Proto.ino"
void loop();
#line 18 "<SKETCH>/Proto.ino"
void blinkTimes(int n);
#line 22 "<SKETCH>/Proto.ino"
Reading takeReading(uint8_t pin);
#line 26 "<SKETCH>/Proto.ino"
static void report(const Reading &r);
#line 9 "<SKETCH>/Proto.ino"
void setup() {
  Serial.begin(115200);
  blinkTimes(3);
  Reading r = takeReading(A0);
  report(r);
}

void loop() {}

void blinkTimes(int n) {
  for (int i = 0; i < n; i++) digitalWrite(LED_BUILTIN, i % 2);
}

Reading takeReading(uint8_t pin) {
  return Reading{analogRead(pin)};
}

static void report(const Reading &r) {
  Serial.println(r.value);
}

