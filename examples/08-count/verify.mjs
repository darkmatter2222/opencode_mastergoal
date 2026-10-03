import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.deepEqual(solve("Red blue RED"),{red:2,blue:1});assert.deepEqual(solve(""),{});
