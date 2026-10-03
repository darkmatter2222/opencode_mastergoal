import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.equal(solve(0),1);assert.equal(solve(5),120);assert.throws(()=>solve(-1));
