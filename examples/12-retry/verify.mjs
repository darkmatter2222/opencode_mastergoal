import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
let n=0;assert.equal(await solve(async()=>{if(++n<3)throw Error("retry");return 7},3),7);assert.equal(n,3);await assert.rejects(solve(async()=>{throw Error("no")},2));
