import { describe, expect, it } from 'vitest';
import { Coordinates, Qibla } from 'adhan';
import {
  calculateQiblaBearing,
  compassPointName,
  distanceToKaabaKm,
  normalizeBearing,
  qiblaIsMeaningful,
} from '../src/qibla/bearing';
import { isAlignedWithQibla, qiblaNeedleRotation } from '../src/qibla/compass';

describe('Qibla bearing (spec §19, §48)', () => {
  const cities = [
    { name: 'New York', latitude: 40.64, longitude: -73.98, expected: 58.5 },
    { name: 'London', latitude: 51.5074, longitude: -0.1278, expected: 119.0 },
    { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437, expected: 23.9 },
    { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, expected: 293.0 },
    { name: 'Dhaka', latitude: 23.8103, longitude: 90.4125, expected: 277.6 },
  ];

  for (const city of cities) {
    it(`${city.name} points to roughly ${city.expected} degrees`, () => {
      expect(calculateQiblaBearing(city.latitude, city.longitude)).toBeCloseTo(city.expected, 0);
    });
  }

  it('agrees with adhan\'s independent implementation everywhere we check', () => {
    for (const city of cities) {
      const ours = calculateQiblaBearing(city.latitude, city.longitude);
      const theirs = Qibla(new Coordinates(city.latitude, city.longitude));
      expect(Math.abs(ours - theirs), city.name).toBeLessThan(0.01);
    }
  });

  it('always returns a value in [0, 360)', () => {
    for (let latitude = -80; latitude <= 80; latitude += 10) {
      for (let longitude = -180; longitude < 180; longitude += 15) {
        const bearing = calculateQiblaBearing(latitude, longitude);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
        expect(Number.isFinite(bearing)).toBe(true);
      }
    }
  });

  it('points broadly east from the Americas and broadly west from East Asia', () => {
    expect(calculateQiblaBearing(40.64, -73.98)).toBeLessThan(180);
    expect(calculateQiblaBearing(35.6762, 139.6503)).toBeGreaterThan(180);
  });

  it('treats a position at the Kaaba as having no meaningful direction', () => {
    expect(qiblaIsMeaningful(21.4225, 39.8262)).toBe(false);
    expect(distanceToKaabaKm(21.4225, 39.8262)).toBeLessThan(0.1);
    expect(qiblaIsMeaningful(40.64, -73.98)).toBe(true);
  });

  it('measures a sensible distance to Makkah', () => {
    expect(distanceToKaabaKm(40.64, -73.98)).toBeGreaterThan(10_000);
    expect(distanceToKaabaKm(40.64, -73.98)).toBeLessThan(11_000);
  });

  it('rejects impossible coordinates', () => {
    expect(() => calculateQiblaBearing(95, 0)).toThrow();
    expect(() => calculateQiblaBearing(0, 200)).toThrow();
  });

  it('normalises negative and oversized bearings', () => {
    expect(normalizeBearing(-1)).toBeCloseTo(359);
    expect(normalizeBearing(720.5)).toBeCloseTo(0.5);
  });

  it('names the direction in words so it is not conveyed by the dial alone', () => {
    expect(compassPointName(58.5)).toBe('east-northeast');
    expect(compassPointName(0)).toBe('north');
    expect(compassPointName(180)).toBe('south');
  });
});

describe('compass maths (spec §20)', () => {
  it('rotates the needle by the difference between Qibla and heading', () => {
    expect(qiblaNeedleRotation(58.5, 0)).toBeCloseTo(58.5);
    expect(qiblaNeedleRotation(58.5, 58.5)).toBeCloseTo(0);
    expect(qiblaNeedleRotation(10, 350)).toBeCloseTo(20);
  });

  it('detects alignment across the 0/360 wrap', () => {
    expect(isAlignedWithQibla(2, 359)).toBe(true);
    expect(isAlignedWithQibla(58.5, 58)).toBe(true);
    expect(isAlignedWithQibla(58.5, 120)).toBe(false);
  });
});
