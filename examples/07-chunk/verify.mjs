import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.deepEqual(solve([1,2,3,4,5],2),[[1,2],[3,4],[5]]);assert.throws(()=>solve([1],0));
