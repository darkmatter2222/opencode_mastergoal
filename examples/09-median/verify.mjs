import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.equal(solve([3,1,2]),2);assert.equal(solve([4,1,2,3]),2.5);assert.throws(()=>solve([]));
