import { consumeTranscriptDelta, appendIncompleteUtterance } from '../transcriptDelta';

describe('consumeTranscriptDelta', () => {
  it('sends the first window as 1..x', () => {
    expect(consumeTranscriptDelta('add two mango', 0)).toEqual({
      chunk: 'add two mango',
      nextSentLength: 13,
    });
  });

  it('sends only the new suffix x..y on the next tick', () => {
    expect(consumeTranscriptDelta('add two mango price 50', 13)).toEqual({
      chunk: ' price 50',
      nextSentLength: 22,
    });
  });

  it('returns an empty chunk when nothing new has arrived', () => {
    expect(consumeTranscriptDelta('add two mango', 13)).toEqual({
      chunk: '',
      nextSentLength: 13,
    });
  });

  it('flushes the remaining tail after a partial window', () => {
    expect(consumeTranscriptDelta('add two mango price 50 save', 22)).toEqual({
      chunk: ' save',
      nextSentLength: 27,
    });
  });

  it('trims whitespace-only remainders and still advances the cursor', () => {
    expect(consumeTranscriptDelta('add two mango ', 13)).toEqual({
      chunk: '',
      nextSentLength: 14,
    });
  });

  it('rewinds the cursor when the live transcript shrinks', () => {
    expect(consumeTranscriptDelta('add two', 20)).toEqual({
      chunk: '',
      nextSentLength: 7,
    });
  });
});

describe('appendIncompleteUtterance', () => {
  it('starts with the first chunk', () => {
    expect(appendIncompleteUtterance('', 'Main')).toBe('Main');
  });

  it('stitches later chunks without inserting a space', () => {
    expect(appendIncompleteUtterance('Main', 'customer')).toBe('Maincustomer');
    expect(appendIncompleteUtterance('Ram', 'esh')).toBe('Ramesh');
    expect(appendIncompleteUtterance('Add item ear', 'phone')).toBe(
      'Add item earphone',
    );
  });

  it('keeps a space that was already in the STT suffix', () => {
    expect(appendIncompleteUtterance('Main', ' customer')).toBe('Main customer');
  });

  it('ignores blank chunks', () => {
    expect(appendIncompleteUtterance('Main customer', '  ')).toBe(
      'Main customer',
    );
  });
});
