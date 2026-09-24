import { describe, expect, it } from 'vitest';
import {
  compareAthleteNames,
  findAthleteColumnIndex,
  sortAthleteRawDataRows,
} from '../src/athlete-raw-sort.js';

describe('athlete raw data grouping', () => {
  it('finds Athlete / Athlete Name headers case-insensitively', () => {
    expect(findAthleteColumnIndex(['Week Tab', 'Athlete', 'Workout Type'])).toBe(1);
    expect(findAthleteColumnIndex(['athlete name', 'Week'])).toBe(0);
    expect(findAthleteColumnIndex(['Week Tab', 'Workout Type'])).toBe(-1);
  });

  it('compares athlete names case-insensitively', () => {
    expect(compareAthleteNames('alex smith', 'AVIK CHATTERJEE')).toBeLessThan(0);
    expect(compareAthleteNames('Neil Thomas', 'neil thomas')).toBe(0);
    expect(compareAthleteNames('Joseph Smith', 'Daniel Friend')).toBeGreaterThan(0);
  });

  it('groups chronological extract rows by athlete while keeping within-athlete order', () => {
    // Mirrors the "Incorrect Sort" shape: Mile Tests first across athletes, then Week 1.
    const headers = ['Athlete', 'Week Tab', 'Workout Type'];
    const athleteIdx = findAthleteColumnIndex(headers);
    const chronological = [
      ['Daniel Friend', 'Mile Test', 'Mile Test (Max HR Test)'],
      ['Neil Thomas', 'Mile Test', 'Mile Test (Max HR Test)'],
      ['Joseph Smith', 'Mile Test', 'Mile Test (Max HR Test)'],
      ['Neil Thomas', 'Week 1 (Foundation)', 'Sprint Intervals'],
      ['Joseph Smith', 'Week 1 (Foundation)', 'Sprint Intervals'],
      ['Daniel Friend', 'Week 1 (Foundation)', 'Benchmark Run + S&C'],
      ['Neil Thomas', 'Week 1 (Foundation)', 'Threshold Run'],
      ['Daniel Friend', 'Week 1 (Foundation)', 'Easy Run'],
    ];

    const grouped = sortAthleteRawDataRows(chronological, athleteIdx);

    expect(grouped.map((row) => row[0])).toEqual([
      'Daniel Friend',
      'Daniel Friend',
      'Daniel Friend',
      'Joseph Smith',
      'Joseph Smith',
      'Neil Thomas',
      'Neil Thomas',
      'Neil Thomas',
    ]);

    // Within Daniel Friend, prior week chronology is preserved (stable sort).
    expect(grouped.filter((row) => row[0] === 'Daniel Friend').map((row) => row[2])).toEqual([
      'Mile Test (Max HR Test)',
      'Benchmark Run + S&C',
      'Easy Run',
    ]);
  });

  it('matches the correct-sort screenshot grouping pattern', () => {
    const rows = [
      ['Elizabeth Kremer', 'Mile Test', 'Mile Test (Max HR Test)'],
      ['Alex Smith', 'Mile Test', 'Mile Test (Max HR Test)'],
      ['Elizabeth Kremer', 'Week 1 (Foundation)', 'Sprint Intervals'],
      ['Analisa LaCour', 'Week 1 (Foundation)', 'Threshold Run'],
      ['Alex Smith', 'Week 1 (Foundation)', 'Easy Run'],
      ['AVIK CHATTERJEE', 'Week 1 (Foundation)', 'Long Run + S&C'],
      ['Elizabeth Kremer', 'Week 1 (Foundation)', 'Long Run + S&C'],
    ];

    const grouped = sortAthleteRawDataRows(rows, 0);
    expect(grouped.map((row) => row[0])).toEqual([
      'Alex Smith',
      'Alex Smith',
      'Analisa LaCour',
      'AVIK CHATTERJEE',
      'Elizabeth Kremer',
      'Elizabeth Kremer',
      'Elizabeth Kremer',
    ]);
  });
});
