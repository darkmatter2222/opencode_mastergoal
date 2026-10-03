import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.deepEqual(solve([[1,2,3],[4,5,6]]),[[1,4],[2,5],[3,6]]);assert.deepEqual(solve([]),[]);
