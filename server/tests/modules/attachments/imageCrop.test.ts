import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitCrop, parseCropParam } from '../../../src/modules/attachments/imageCrop.js';

describe('parseCropParam', () => {
  it('reads x,y,width,height and rounds them', () => {
    assert.deepEqual(parseCropParam('10,20.4,100.6,50'), { left: 10, top: 20, width: 101, height: 50 });
  });

  it('refuses anything else', () => {
    for (const raw of [undefined, '', '1,2,3', '1,2,3,4,5', '-1,0,10,10', '0,0,0,10', 'a,b,c,d', '0,0,1e3,10', 'Infinity,0,1,1']) {
      assert.equal(parseCropParam(raw), null, String(raw));
    }
  });
});

describe('fitCrop', () => {
  it('keeps a rect that fits', () => {
    assert.deepEqual(fitCrop({ left: 0, top: 0, width: 10, height: 10 }, 10, 10), { left: 0, top: 0, width: 10, height: 10 });
  });

  it('trims one pixel of rounding past the edge', () => {
    assert.deepEqual(fitCrop({ left: 1, top: 1, width: 10, height: 10 }, 10, 10), { left: 1, top: 1, width: 9, height: 9 });
  });

  it('refuses a rect really outside the picture', () => {
    assert.equal(fitCrop({ left: 5, top: 0, width: 10, height: 10 }, 10, 10), null);
    assert.equal(fitCrop({ left: 10, top: 0, width: 1, height: 1 }, 10, 10), null);
  });
});
