import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.deepEqual(solve([3,1,3,2,1]),[3,1,2]);assert.deepEqual(solve([]),[]);
