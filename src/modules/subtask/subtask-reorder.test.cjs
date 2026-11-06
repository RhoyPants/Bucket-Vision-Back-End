const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(failId) {
  let items = [
    { id: 'a', taskId: 't', status: 0, order: 0, title: 'A', budgetAllocated: 10 },
    { id: 'b', taskId: 't', status: 1, order: 0, title: 'B', budgetAllocated: 20 },
    { id: 'c', taskId: 't', status: 2, order: 0, title: 'C', budgetAllocated: 30 },
    { id: 'z', taskId: 'other', status: 0, order: 0 },
  ];
  const logs = [], locks = [];
  const tx = {
    $queryRaw: async (query) => { locks.push(query.join('?')); },
    subtask: {
      findUnique: async ({ where }) => ({ ...items.find((item) => item.id === where.id) }),
      findMany: async ({ where, orderBy }) => {
        const found = items.filter((item) => item.taskId === where.taskId && (where.status === undefined || item.status === where.status));
        return orderBy ? found.sort((a, b) => a.order - b.order) : found;
      },
      update: async ({ where, data }) => {
        if (where.id === failId) throw Error('Database failure');
        const item = items.find((item) => item.id === where.id);
        Object.assign(item, data); return { ...item };
      },
      updateMany: async () => assert.fail('WBS order must not use status-column shifts'),
    },
    activityLog: { create: async ({ data }) => logs.push(data) },
  };
  const prisma = { $transaction: async (fn) => {
    const before = structuredClone(items);
    try { return await fn(tx); } catch (error) { items = before; throw error; }
  } };
  const filename = path.join(__dirname, 'subtask.service.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const exported = {};
  vm.runInNewContext(code, { exports: exported, require: () => ({ __esModule: true, default: prisma }) }, { filename });
  return { service: exported.SubtaskService, snapshot: () => JSON.parse(JSON.stringify(items)), logs, locks };
}

test('WBS reorder spans all task statuses and normalizes duplicate order values', async () => {
  const state = setup();
  const before = state.snapshot();
  await state.service.moveSubtask('c', null, 0, 'user', ['c', 'a', 'b']);
  const after = state.snapshot();
  assert.deepEqual(after.filter((item) => item.taskId === 't').sort((a, b) => a.order - b.order).map((item) => item.id), ['c', 'a', 'b']);
  assert.deepEqual(after.map(({ order, ...item }) => item), before.map(({ order, ...item }) => item));
  assert.equal(after.find((item) => item.id === 'z').order, 0);
  assert.match(state.locks[0], /Task.*FOR UPDATE/);
  assert.equal(state.logs.length, 1);
});

test('WBS order rejects missing, duplicate, foreign, and mismatched IDs', async () => {
  for (const [order, ids] of [[0, ['c', 'a']], [0, ['c', 'a', 'a']], [0, ['c', 'a', 'z']], [1, ['c', 'a', 'b']], [0, 'invalid'], [-1, ['c', 'a', 'b']]]) {
    const state = setup(); const before = state.snapshot();
    await assert.rejects(state.service.moveSubtask('c', null, order, 'user', ids));
    assert.deepEqual(state.snapshot(), before);
  }
});

test('WBS order rolls back all sibling updates when persistence fails', async () => {
  const state = setup('b'); const before = state.snapshot();
  await assert.rejects(state.service.moveSubtask('c', null, 0, 'user', ['c', 'a', 'b']), /Database failure/);
  assert.deepEqual(state.snapshot(), before);
});

test('Kanban calls without orderedIds retain the existing status-column path', async () => {
  const state = setup(); const before = state.snapshot();
  // A Kanban no-op exits early and does not normalize the other statuses.
  await state.service.moveSubtask('a', null, 0, 'user');
  assert.deepEqual(state.snapshot(), before);
  assert.equal(state.locks.length, 0);
});
