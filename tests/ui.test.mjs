import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');

const workspaceStart = html.indexOf('id="projectBuilder"');
const estimateStart = html.indexOf('class="project-subdetails estimate-details"');
const actualStart = html.indexOf('class="project-subdetails actual-details"');
const comparisonStart = html.indexOf('class="comparison-box"');
const completionButton = html.indexOf('id="completeProject"');
const workspaceEnd = html.indexOf('</section>', workspaceStart);

assert.ok(workspaceStart >= 0, 'project workspace exists');
assert.ok(estimateStart > workspaceStart, 'estimate is inside the project workspace');
assert.ok(actualStart > estimateStart, 'actual expenses follow the estimate');
assert.ok(comparisonStart > actualStart, 'plan-to-actual comparison is inside actual expenses');
assert.ok(completionButton > comparisonStart, 'completion action follows actual expenses and comparison');
assert.ok(completionButton < workspaceEnd, 'completion action stays inside the project workspace');
assert.equal((html.match(/id="completeProject"/g) || []).length, 1, 'completion action is unique');
assert.match(html, /id="projectHistory" class="project-history"/, 'project library is a separate disclosure');
assert.match(css, /\.project-workspace\s*\{/, 'active project has a distinct visual workspace');
assert.match(css, /\.project-completion-panel\s*\{/, 'completion has a dedicated visual panel');

console.log('UI structure tests OK');
