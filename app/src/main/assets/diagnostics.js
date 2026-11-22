'use strict';

window.HexDiagnostics = (() => {
  const loaded = new Map();
  const supported = new Set(['html','htm','css','js','mjs','cjs','ts','json','py','yaml','yml']);
  const scriptFor = {
    html: 'htmlhint.min.js', htm: 'htmlhint.min.js', css: 'csstree.js', js: 'acorn.js',
    mjs: 'acorn.js', cjs: 'acorn.js', ts: 'typescript.js', py: 'skulpt.min.js',
    yaml: 'js-yaml.min.js', yml: 'js-yaml.min.js'
  };
  function extension(path) { return (path || '').split('.').pop().toLowerCase(); }
  function load(file) {
    if (!file) return Promise.resolve();
    if (!loaded.has(file)) {
      loaded.set(file, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/' + file;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load the checker.'));
        document.head.append(script);
      }));
    }
    return loaded.get(file);
  }
  function issue(message, line = 1, column = 1, severity = 'error') {
    return {message, line: Math.max(1, line || 1), column: Math.max(1, column || 1), severity};
  }
  function locationAt(text, offset) {
    const lines = text.slice(0, offset).split('\n');
    return [lines.length, lines[lines.length - 1].length + 1];
  }
  function typescriptIssues(path, source) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const options = {noLib: true, noEmit: true, strict: true, target: ts.ScriptTarget.ES2020};
    const host = {
      getSourceFile: name => name === path ? file : undefined,
      getDefaultLibFileName: () => 'lib.d.ts',
      writeFile() {},
      getCurrentDirectory: () => '',
      getCanonicalFileName: name => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: name => name === path,
      readFile: name => name === path ? source : undefined
    };
    const program = ts.createProgram([path], options, host);
    const supportedTypes = new Set([2322, 2345, 2352, 2362, 2363, 2554, 2741, 2769]);
    const diagnostics = [...program.getSyntacticDiagnostics(file),
      ...program.getSemanticDiagnostics(file).filter(item => supportedTypes.has(item.code))];
    return diagnostics.map(item => {
      const pos = file.getLineAndCharacterOfPosition(item.start || 0);
      return issue(ts.flattenDiagnosticMessageText(item.messageText, '\n'), pos.line + 1, pos.character + 1);
    });
  }
  async function inspect(path, text) {
    const ext = extension(path);
    if (!supported.has(ext)) return null;
    await load(scriptFor[ext]);
    try {
      if (ext === 'html' || ext === 'htm') {
        return HTMLHint.HTMLHint.verify(text, {
          'tag-pair': true, 'attr-no-duplication': true, 'id-unique': true,
          'attr-value-double-quotes': true, 'spec-char-escape': true
        }).map(item => issue(item.message, item.line, item.col, item.type === 'warning' ? 'warning' : 'error'));
      }
      if (ext === 'css') {
        const issues = [];
        csstree.parse(text, {positions: true, onParseError: error => issues.push(issue(error.message, error.line, error.column))});
        return issues;
      }
      if (ext === 'ts') return typescriptIssues(path, text);
      if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
        acorn.parse(text, {ecmaVersion: 'latest', sourceType: ext === 'cjs' ? 'script' : 'module'});
      } else if (ext === 'json') {
        JSON.parse(text);
      } else if (ext === 'py') {
        Sk.configure({__future__: Sk.python3});
        Sk.parse(path, text);
      } else {
        jsyaml.loadAll(text);
      }
      return [];
    } catch (error) {
      if (error.loc) return [issue(error.message, error.loc.line, error.loc.column + 1)];
      if (error.mark) return [issue(error.reason, error.mark.line + 1, error.mark.column + 1)];
      if (ext === 'py') {
        const frame = (error.traceback || [])[0] || {};
        return [issue(String(error).replace(/ on line \d+$/, ''), frame.lineno, frame.colno)];
      }
      const offset = /position (\d+)/.exec(error.message || '');
      const pos = offset ? locationAt(text, Number(offset[1])) : [error.line, error.column];
      return [issue(error.message || String(error), ...pos)];
    }
  }
  return {inspect, extension, supported};
})();
