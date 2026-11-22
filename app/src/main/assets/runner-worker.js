'use strict';

const send = self.postMessage.bind(self);
let outputCount = 0;
function write(value) {
  if (++outputCount <= 150) send({kind: 'output', value: String(value).slice(0, 4000)});
}
function format(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value) ?? String(value); }
  catch (error) { return String(value); }
}
const capture = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'table'].map(level => [
  level, (...args) => write(args.map(format).join(' ') + '\n')
]));

async function runScript(source, typed) {
  let script = source;
  if (typed) {
    importScripts('vendor/typescript.js');
    const result = ts.transpileModule(source, {
      compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS},
      reportDiagnostics: true,
      fileName: 'input.ts'
    });
    const errors = result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
    script = result.outputText;
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const module = {exports: {}};
  const run = new AsyncFunction('console', 'exports', 'module', script);
  const result = await run(capture, module.exports, module);
  if (result !== undefined) write(format(result) + '\n');
}

async function runPython(source) {
  importScripts('vendor/skulpt.min.js', 'vendor/skulpt-stdlib.js');
  Sk.configure({
    output: write,
    read(path) {
      const file = Sk.builtinFiles.files[path];
      if (file === undefined) throw new Error('Unavailable Python module: ' + path);
      return file;
    },
    __future__: Sk.python3,
    execLimit: 9000,
    yieldLimit: 100
  });
  await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<hexflow>', false, source, true));
}

async function runSql(source) {
  importScripts('vendor/sql-asm.js');
  const engine = await initSqlJs();
  const database = new engine.Database();
  try {
    const results = database.exec(source);
    for (const result of results) {
      write(result.columns.join('  |  ') + '\n');
      for (const row of result.values.slice(0, 100)) write(row.map(format).join('  |  ') + '\n');
      if (result.values.length > 100) write('Showing the first 100 rows.\n');
    }
    if (!results.length) write('SQL executed successfully. Rows changed: ' + database.getRowsModified() + '\n');
  } finally {
    database.close();
  }
}

self.onmessage = async ({data}) => {
  try {
    if (data.language === 'python') await runPython(data.source);
    else if (data.language === 'sql') await runSql(data.source);
    else if (data.language === 'javascript' || data.language === 'typescript') {
      await runScript(data.source, data.language === 'typescript');
    } else throw new Error('Unsupported runtime.');
    send({kind: 'done'});
  } catch (error) {
    send({kind: 'error', value: String(error)});
  }
};
