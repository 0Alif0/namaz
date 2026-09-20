import { describe, expect, it } from 'vitest';
import { pickName } from '../src/location/reverseGeocode';

/*
 * Captured from BigDataCloud's reverse-geocode-client, so these are the shapes
 * the app really receives rather than invented ones. Note that `city` and
 * `locality` swap usefulness depending on the country.
 */
const BROOKLYN = {
  city: 'New York City',
  locality: 'Brooklyn',
  principalSubdivision: 'New York',
  countryName: 'United States of America',
  countryCode: 'US',
};

const CHICAGO = {
  city: 'Chicago',
  locality: 'Chicago',
  principalSubdivision: 'Illinois',
  countryName: 'United States of America',
  countryCode: 'US',
};

const LONDON = {
  city: 'London',
  locality: 'City of Westminster',
  principalSubdivision: 'England',
  countryName: 'United Kingdom of Great Britain and Northern Ireland',
  countryCode: 'GB',
};

const DHAKA = {
  city: 'Dhaka',
  locality: 'Dhaka',
  principalSubdivision: 'Dhaka',
  countryName: 'Bangladesh',
  countryCode: 'BD',
};

const TORONTO = {
  city: 'Toronto',
  locality: 'Financial District',
  principalSubdivision: 'Ontario',
  countryName: 'Canada',
  countryCode: 'CA',
};

describe('place names (spec §9)', () => {
  it('names US places by neighbourhood and state', () => {
    // "New York City, New York" would be worse than either half alone.
    expect(pickName(BROOKLYN)).toBe('Brooklyn, New York');
    expect(pickName(CHICAGO)).toBe('Chicago, Illinois');
  });

  it('names places elsewhere by city and country', () => {
    // Not "City of Westminster, England".
    expect(pickName(LONDON)).toBe('London, United Kingdom');
    expect(pickName(TORONTO)).toBe('Toronto, Canada');
  });

  it('shortens the formal country name', () => {
    expect(pickName(LONDON)).not.toContain('Great Britain');
  });

  it('does not repeat a name that is both city and region', () => {
    expect(pickName(DHAKA)).toBe('Dhaka, Bangladesh');
  });

  it('falls back sensibly as fields go missing', () => {
    // No state available, so the country stands in rather than nothing.
    expect(pickName({ locality: 'Brooklyn', countryCode: 'US' })).toBe('Brooklyn, United States');
    expect(pickName({ locality: 'Brooklyn' })).toBe('Brooklyn');
    expect(pickName({ principalSubdivision: 'Bavaria', countryName: 'Germany', countryCode: 'DE' }))
      .toBe('Bavaria, Germany');
    expect(pickName({ countryName: 'Germany', countryCode: 'DE' })).toBe('Germany');
    expect(pickName({})).toBeNull();
  });

  it('never returns coordinates, whatever arrives', () => {
    for (const data of [BROOKLYN, LONDON, DHAKA, TORONTO, {}]) {
      const name = pickName(data);
      if (name) expect(name).not.toMatch(/-?\d+\.\d+/);
    }
  });
});
