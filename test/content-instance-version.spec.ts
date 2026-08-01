import { describe, expect, it } from 'vitest';
import { readContentSnapshot, stampContentSnapshot, stripContentSnapshot } from '../src/content/content-instance-version.js';

describe('content instance versioning', () => {
  it('keeps the exact item definition used when the instance was created', () => {
    const state = stampContentSnapshot({ affixes: ['old'] }, {
      instanceType: 'ITEM', contentVersion: 'v1', definitionKey: 'sword',
      definition: { key: 'sword', damage: 7 },
    });
    expect(readContentSnapshot<{ key: string; damage: number }>(state, 'ITEM')).toEqual({
      instanceType: 'ITEM', contentVersion: 'v1', definitionKey: 'sword',
      definition: { key: 'sword', damage: 7 },
    });
    expect(stripContentSnapshot(state)).toEqual({ affixes: ['old'] });
  });
});
