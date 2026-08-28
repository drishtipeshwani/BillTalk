import {
  entityNamesMatch,
  fuzzyMatchEntityName,
  normalizeEntityName,
} from '../entityName';

describe('normalizeEntityName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeEntityName('  Ramesh   Kumar  ')).toBe('Ramesh Kumar');
  });

  it('treats case and spacing as the same name', () => {
    expect(entityNamesMatch('ramesh', '  Ramesh ')).toBe(true);
    expect(entityNamesMatch('pens', 'notebooks')).toBe(false);
  });
});

describe('fuzzyMatchEntityName', () => {
  it('matches British/American spelling within one edit', () => {
    expect(fuzzyMatchEntityName('yoghurt', ['Yogurt', 'Milk'])).toBe('Yogurt');
  });

  it('does not match short distinct names like Archie and Achi', () => {
    expect(fuzzyMatchEntityName('archie', ['Achi', 'Ramesh'])).toBeNull();
  });

  it('returns the catalog spelling on an exact case-insensitive hit', () => {
    expect(fuzzyMatchEntityName('ramesh', ['Ramesh'])).toBe('Ramesh');
  });

  it('rejects two equally close candidates', () => {
    expect(fuzzyMatchEntityName('mango', ['mengo', 'mange'])).toBeNull();
  });
});
