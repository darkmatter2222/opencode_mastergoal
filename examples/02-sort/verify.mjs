import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
const a=[10,2,1];assert.deepEqual(solve(a),[1,2,10]);assert.deepEqual(a,[10,2,1]);
