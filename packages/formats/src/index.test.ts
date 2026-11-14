import { expect, test } from 'vitest';
import { packageName } from './index';

test('exports its package name', () => {
  expect(packageName).toBe('@aoe/formats');
});
