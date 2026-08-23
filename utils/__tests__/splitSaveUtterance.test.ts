import { splitSaveUtterance } from '../splitSaveUtterance';

describe('splitSaveUtterance', () => {
  it('splits from the last save word, including everything after it', () => {
    expect(
      splitSaveUtterance(
        'Make price of mango as 50 quantity as one save the bill',
      ),
    ).toEqual([
      'Make price of mango as 50 quantity as one',
      'save the bill',
    ]);
  });

  it('keeps filler before save in the first utterance', () => {
    expect(splitSaveUtterance('please save')).toEqual(['please', 'save']);
    expect(splitSaveUtterance('add mango and save the bill')).toEqual([
      'add mango and',
      'save the bill',
    ]);
  });

  it('leaves a save-only utterance as one entry', () => {
    expect(splitSaveUtterance('save the bill')).toEqual(['save the bill']);
    expect(splitSaveUtterance('saved')).toEqual(['saved']);
  });

  it('leaves utterances with no save word unchanged', () => {
    expect(splitSaveUtterance('add mango quantity 1')).toEqual([
      'add mango quantity 1',
    ]);
  });

  it('splits on saved and saves as well', () => {
    expect(splitSaveUtterance('add mango saved the bill')).toEqual([
      'add mango',
      'saved the bill',
    ]);
    expect(splitSaveUtterance('set quantity as one saves invoice')).toEqual([
      'set quantity as one',
      'saves invoice',
    ]);
  });

  it('splits from the last save word when it appears twice', () => {
    expect(splitSaveUtterance('save mango and save the bill')).toEqual([
      'save mango and',
      'save the bill',
    ]);
  });
});
