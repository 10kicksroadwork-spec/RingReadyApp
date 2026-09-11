import { describe, expect, it } from 'vitest';
import {
  PROOF_GAP_OUTAGE_WAIVER_BEFORE_ISO,
  isProofGapWaivedForOutage,
} from '../src/coach-proof.js';
import { buildAthleteRecord, buildLiveRoster } from '../src/coach-preview.js';

describe('proof gap outage waiver', () => {
  it('waives historical / timestamp-less sessions and keeps post-cutoff gaps', () => {
    expect(isProofGapWaivedForOutage({ completedAt: '2026-09-09T12:00:00.000Z' })).toBe(true);
    expect(isProofGapWaivedForOutage({})).toBe(true);
    expect(isProofGapWaivedForOutage({ completedAt: 'not-a-date' })).toBe(true);
    expect(isProofGapWaivedForOutage({
      completedAt: '2026-09-11T00:00:00.000Z',
    })).toBe(false);
    expect(isProofGapWaivedForOutage({
      completedAt: '2026-09-12T15:00:00.000Z',
    })).toBe(false);
    expect(Date.parse(PROOF_GAP_OUTAGE_WAIVER_BEFORE_ISO)).toBeGreaterThan(0);
  });

  it('clears coach proof-gap attention for pre-waiver logged sessions without attachments', () => {
    const payload = {
      profiles: [{
        user_id: 'u-waiver',
        athlete_name: 'Waiver Casey',
        camp_length: 7,
        fight_date: '2026-11-01',
      }],
      hrRows: [{ user_id: 'u-waiver', max_hr: 190, resting_hr: 50 }],
      completions: [{
        user_id: 'u-waiver',
        completion_key: '0:1',
        week_index: 0,
        workout_index: 1,
        workout_type: 'Benchmark Run + S&C',
        avg_bpm: 140,
        target_bpm: 137,
        completed_at: '2026-09-08T18:00:00.000Z',
        record_json: {},
      }, {
        user_id: 'u-waiver',
        completion_key: '0:3',
        week_index: 0,
        workout_index: 3,
        workout_type: 'Easy Run',
        avg_bpm: 138,
        target_bpm: 137,
        completed_at: '2026-09-09T18:00:00.000Z',
        record_json: {},
      }],
      sprints: [],
      mileTests: [],
      notes: [],
      identities: [{ user_id: 'u-waiver', email: 'casey@example.com' }],
      exclusions: [],
      meta: [{
        athlete_user_id: 'u-waiver',
        camp_start_date: '2026-09-01',
      }],
      attachments: [],
      sources: {
        profiles: true,
        hrRows: true,
        completions: true,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: true,
        exclusions: true,
        meta: true,
        attachments: true,
      },
    };

    const roster = buildLiveRoster(payload);
    expect(roster).toHaveLength(1);
    const athlete = roster[0];
    expect(athlete.proofGaps).toBe(0);
    expect(athlete.tone).not.toBe('proof');
    expect(athlete.attention.join(' ')).not.toMatch(/proof gap/i);
    expect(athlete.sessions.every((session) => session.proof !== 'missing')).toBe(true);
  });

  it('still flags post-waiver sessions that lack proof', () => {
    const payload = {
      profiles: [{
        user_id: 'u-new',
        athlete_name: 'New Gap',
        camp_length: 7,
        fight_date: '2026-11-15',
      }],
      hrRows: [{ user_id: 'u-new', max_hr: 188, resting_hr: 52 }],
      completions: [{
        user_id: 'u-new',
        completion_key: '0:1',
        week_index: 0,
        workout_index: 1,
        workout_type: 'Benchmark Run + S&C',
        avg_bpm: 140,
        target_bpm: 137,
        completed_at: '2026-09-12T12:00:00.000Z',
        record_json: {},
      }],
      sprints: [],
      mileTests: [],
      notes: [],
      identities: [{ user_id: 'u-new', email: 'newgap@example.com' }],
      exclusions: [],
      meta: [{
        athlete_user_id: 'u-new',
        camp_start_date: '2026-08-01',
      }],
      attachments: [],
      sources: {
        profiles: true,
        hrRows: true,
        completions: true,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: true,
        exclusions: true,
        meta: true,
        attachments: true,
      },
    };

    const roster = buildLiveRoster(payload);
    expect(roster).toHaveLength(1);
    const athlete = roster[0];
    expect(athlete.proofGaps).toBeGreaterThan(0);
    expect(athlete.attention.join(' ')).toMatch(/proof gap/i);
    // Behind takes priority over proof when other sessions are unfinished.
    expect(['proof', 'behind', 'watch']).toContain(athlete.tone);
    expect(athlete.tone).not.toBe('on-track');
  });

  it('does not put proof-only waived athletes into Needs a look attention tone', () => {
    const athlete = buildAthleteRecord({
      id: 'preview-waived',
      name: 'Preview Waived',
      campLength: 7,
      currentWeekIndex: 1,
      campStartDate: '2026-09-01',
      missing: [],
      skipped: [],
      missingProofs: [],
      flags: {},
      avgs: { '0:1': 140 },
      maxes: {},
      minutes: { '0:1': 30 },
      distances: { '0:1': 3.1 },
      sources: { attachments: true, completions: true },
    });
    expect(athlete.proofGaps).toBe(0);
    expect(athlete.tone).toBe('on-track');
    expect(athlete.attention).toEqual([]);
  });
});
