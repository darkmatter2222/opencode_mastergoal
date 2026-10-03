import assert from 'node:assert/strict';
import {solve} from './solution.mjs';
assert.equal(solve("<a>&"),"&lt;a&gt;&amp;");assert.equal(solve("plain"),"plain");
