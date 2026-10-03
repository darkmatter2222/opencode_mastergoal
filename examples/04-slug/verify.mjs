import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.equal(solve(" Hello   World "),"hello-world");assert.equal(solve(""),"");
