import { describe, expect, it } from 'vitest';
import { buildRegistrySnapshot, scoreAuditResults } from './audit-runtime';

describe('audit runtime configuration', () => {
  it('only snapshots database checks that have version-controlled executors', () => {
    const snapshot = buildRegistrySnapshot([
      { id: 'enabled', title: 'Enabled from DB', weight: '2.5', logic_version: '2.0.0', configuration_version: 7 },
      { id: 'unknown', title: 'Not executable', weight: 1, logic_version: '1.0.0', configuration_version: 1 },
    ], new Set(['enabled']));

    expect(snapshot).toEqual([{
      id: 'enabled', title: 'Enabled from DB', weight: 2.5, logicVersion: '2.0.0', configurationVersion: 7,
    }]);
  });

  it('uses snapshot weights and reports executable coverage', () => {
    const snapshot = [
      { id: 'heavy', title: 'Heavy', weight: 3, logicVersion: '1.0.0', configurationVersion: 1 },
      { id: 'light', title: 'Light', weight: 1, logicVersion: '1.0.0', configurationVersion: 1 },
      { id: 'manual', title: 'Manual', weight: 1, logicVersion: '1.0.0', configurationVersion: 1 },
    ];
    const result = scoreAuditResults(snapshot, [
      { check_id: 'heavy', outcome: 'passed' },
      { check_id: 'light', outcome: 'failed' },
      { check_id: 'manual', outcome: 'unable_to_test' },
    ]);

    expect(result).toEqual({ score: 75, coverage: 67 });
  });

  it('scores advisory checks and counts not-applicable checks as executed', () => {
    const snapshot = [
      { id: 'pass', title: 'Pass', weight: 1, logicVersion: '1.0.0', configurationVersion: 1 },
      { id: 'info', title: 'Info', weight: 1, logicVersion: '1.0.0', configurationVersion: 1 },
      { id: 'na', title: 'N/A', weight: 1, logicVersion: '1.0.0', configurationVersion: 1 },
      { id: 'missing', title: 'Missing result', weight: 1, logicVersion: '1.0.0', configurationVersion: 1 },
    ];
    expect(scoreAuditResults(snapshot, [
      { check_id: 'pass', outcome: 'passed' },
      { check_id: 'info', outcome: 'advisory' },
      { check_id: 'na', outcome: 'not_applicable' },
    ])).toEqual({ score: 75, coverage: 75 });
  });
});
