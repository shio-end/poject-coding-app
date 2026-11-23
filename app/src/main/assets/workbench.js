'use strict';

const $ = id => document.getElementById(id);
const storageKey = 'workbench.project.v1';
const example = {
  'index.html': '<!doctype html>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>HexFlow demo</title>\n<link rel="stylesheet" href="style.css">\n<h1>Hello, HexFlow</h1>\n<button id="demo">Tap to test JavaScript</button>\n<script src="main.js"></script>\n',
  'style.css': 'body { font: 18px system-ui; padding: 24px; color: #222; }\nbutton { padding: 12px; }\n',
  'main.js': "document.querySelector('#demo').onclick = () => {\n  console.log('The app is running.');\n  document.querySelector('h1').textContent = 'It works!';\n};\n"
};
let previous = {};
try { previous = JSON.parse(localStorage.getItem(storageKey)) || {}; }
catch (error) { console.warn(error); }

const documents = new Map();
const modes = {
  html: 'htmlmixed', htm: 'htmlmixed', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', ts: 'text/typescript', tsx: 'text/typescript',
  json: 'application/json', css: 'css', py: 'python', java: 'text/x-java',
  c: 'text/x-csrc', cpp: 'text/x-c++src', md: 'markdown', sh: 'shell',
  sql: 'text/x-sql', xml: 'xml', svg: 'xml', yaml: 'yaml', yml: 'yaml',
  kt: 'text/x-kotlin', cs: 'text/x-csharp', h: 'text/x-csrc', hpp: 'text/x-c++src',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'application/x-httpd-php',
  toml: 'toml', dockerfile: 'dockerfile', diff: 'diff', patch: 'diff', swift: 'swift'
};
function makeDoc(path, content) {
  return new CodeMirror.Doc(content, modes[path.split('.').pop().toLowerCase()] || 'text/plain');
}
for (const [path, content] of Object.entries(previous.files || example)) {
  if (validPath(path) && typeof content === 'string') documents.set(path, makeDoc(path, content));
}

let tabs = (previous.tabs || ['index.html']).filter(path => documents.has(path));
let active = null;
let pendingSave;
let previewTimer;
let checkerTimer;
let viewMode = 'editor';
let previewEntry = previous.previewEntry || '';
let checkGeneration = 0;
let lastPreview = '';
const blank = makeDoc('empty.txt', '');
const editor = CodeMirror($('editor'), {
  lineNumbers: true, indentUnit: 2, tabSize: 2, lineWrapping: true,
  autoCloseBrackets: true, matchBrackets: true, inputStyle: 'textarea',
  gutters: ['CodeMirror-linenumbers', 'diagnostic-gutter'],
  extraKeys: {
    'Ctrl-Space': suggest,
    'Ctrl-F': () => { panel('search'); $('query').focus(); },
    'Ctrl-S': persist,
    'Ctrl-P': openPalette,
    'Ctrl-G': goToLine,
    'Ctrl-Enter': runActive
  }
});

function validPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 &&
    path.split('/').every(part => part && part !== '.' && part !== '..' &&
      !/[\\<>:"|?*%#&\u0000-\u001f]/.test(part));
}
function contents() {
  return Object.fromEntries([...documents].map(([path, doc]) => [path, doc.getValue()]));
}
function status(message, state = '') {
  $('status').textContent = message;
  $('status').dataset.state = state;
}
function persist() {
  clearTimeout(pendingSave);
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      files: contents(), tabs, active, theme: $('theme').value, font: $('font').value,
      previewEntry, autoCheck: $('autoCheck').checked
    }));
    status('Saved on this device', 'saved');
  } catch (error) {
    status('Storage is full. Export a ZIP to keep your changes.');
  }
}
function button(label, action) {
  const element = document.createElement('button');
  element.textContent = label;
  element.onclick = action;
  return element;
}
function listItem(parent, child) {
  const li = document.createElement('li');
  li.append(child);
  parent.append(li);
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function render() {
  const tabStrip = $('tabs');
  const oldLeft = new Map();
  if (!reducedMotion.matches) {
    for (const tab of tabStrip.children) oldLeft.set(tab.dataset.path, tab.getBoundingClientRect().left);
  }
  $('tree').replaceChildren();
  for (const path of [...documents.keys()].sort()) {
    const item = button(path, () => { open(path); panel(null); });
    if (path === active) item.classList.add('selected');
    listItem($('tree'), item);
  }
  $('tabs').replaceChildren();
  for (const path of tabs) {
    const tab = document.createElement('div');
    tab.dataset.path = path;
    tab.className = path === active ? 'tab current' : 'tab';
    const select = button(path.split('/').pop(), () => open(path));
    select.title = path;
    select.setAttribute('aria-pressed', String(path === active));
    const close = button('×', () => {
      const index = tabs.indexOf(path);
      tabs = tabs.filter(item => item !== path);
      open(active === path ? tabs[Math.max(0, index - 1)] : active);
    });
    close.setAttribute('aria-label', 'Close ' + path);
    tab.append(select, close);
    $('tabs').append(tab);
  }
  for (const id of ['rename', 'delete', 'save', 'find', 'replace']) $(id).disabled = !active;
  const parts = active ? active.split('/') : [];
  $('fileTitle').textContent = parts.pop() || 'No file open';
  $('fileTitle').title = active || '';
  $('breadcrumb').textContent = parts.join(' / ');
  $('breadcrumb').hidden = parts.length === 0;
  $('language').textContent = active ? HexDiagnostics.extension(active).toUpperCase() : '';
  $('emptyEditor').hidden = Boolean(active);
  const currentTab = $('tabs').querySelector('.current');
  if (currentTab) currentTab.scrollIntoView({block: 'nearest', inline: 'nearest'});
  if (oldLeft.size) {
    for (const tab of tabStrip.children) {
      const previous = oldLeft.get(tab.dataset.path);
      if (previous === undefined) {
        tab.animate([{opacity: 0, transform: 'translateY(4px)'}, {opacity: 1, transform: 'none'}],
          {duration: 145, easing: 'ease-out'});
      } else {
        const offset = previous - tab.getBoundingClientRect().left;
        if (Math.abs(offset) > 1 && Math.abs(offset) < tabStrip.clientWidth) {
          tab.animate([{transform: 'translateX(' + offset + 'px)'}, {transform: 'none'}],
            {duration: 150, easing: 'ease-out'});
        }
      }
    }
  }
  updatePreviewEntries();
  position();
}
function open(path) {
  active = documents.has(path) ? path : null;
  if (active && !tabs.includes(active)) tabs.push(active);
  const doc = documents.get(active) || blank;
  if (editor.getDoc() !== doc) editor.swapDoc(doc);
  editor.setOption('readOnly', !active);
  render();
  persist();
  scheduleCheck();
  queuePreview();
  if (activePanel === 'outline') renderOutline();
}
function position() {
  const {line, ch} = editor.getCursor();
  $('position').textContent = active ? 'Ln ' + (line + 1) + ', Col ' + (ch + 1) : '';
}
const panelNames = {
  files: 'Files', search: 'Search', problems: 'Problems', more: 'Workspace tools',
  outline: 'Outline', project: 'Import & export', settings: 'Settings'
};
let activePanel = null;
let drawerAnimation = null;
let drag = null;

function panel(id, settle = false) {
  if (id === activePanel && !settle) return;
  const drawer = $('toolDrawer');
  const from = drawer.getBoundingClientRect().height;
  const previousPanel = activePanel;
  activePanel = id;
  drag = null;
  drawer.style.removeProperty('height');
  if (drawerAnimation) {
    drawerAnimation.cancel();
    drawerAnimation = null;
  }
  if (id) {
    drawer.hidden = false;
    drawer.inert = false;
    drawer.removeAttribute('aria-hidden');
    $('drawerTitle').textContent = panelNames[id];
    for (const section of drawer.querySelectorAll('.panel')) section.hidden = section.id !== id;
    if (id === 'outline') renderOutline();
  } else {
    const selected = document.querySelector('.tools .current');
    if (selected && drawer.contains(document.activeElement)) selected.focus({preventScroll: true});
    drawer.inert = true;
    drawer.setAttribute('aria-hidden', 'true');
  }
  for (const control of document.querySelectorAll('.tools [data-panel]')) {
    const selected = control.dataset.panel === id;
    control.setAttribute('aria-expanded', String(selected));
    control.classList.toggle('current', selected ||
      (control.dataset.panel === 'more' && ['outline', 'project', 'settings'].includes(id)));
  }
  const to = id ? drawer.getBoundingClientRect().height : 0;
  const finish = () => {
    drawer.hidden = !id;
    drawerAnimation = null;
    editor.refresh();
  };
  if (reducedMotion.matches || Math.abs(to - from) < 1) {
    finish();
  } else {
    const animation = drawer.animate([{height: from + 'px'}, {height: to + 'px'}], {
      duration: id ? 170 : 125, easing: 'cubic-bezier(.2,.75,.25,1)'
    });
    drawerAnimation = animation;
    animation.onfinish = () => { if (animation === drawerAnimation) finish(); };
  }
  if (previousPanel && id && previousPanel !== id && !reducedMotion.matches) {
    $(id).animate([{opacity: 0.4, transform: 'translateY(3px)'}, {opacity: 1, transform: 'none'}],
      {duration: 130, easing: 'ease-out'});
  }
}

const drawerHeader = $('toolDrawer').querySelector('.drawer-header');
drawerHeader.addEventListener('pointerdown', event => {
  if (!activePanel || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
  if (drawerAnimation) drawerAnimation.finish();
  drag = {pointer: event.pointerId, y: event.clientY, height: $('toolDrawer').getBoundingClientRect().height};
  drawerHeader.setPointerCapture(event.pointerId);
});
drawerHeader.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const travel = Math.max(0, event.clientY - drag.y);
  $('toolDrawer').style.height = Math.max(drawerHeader.offsetHeight, drag.height - travel) + 'px';
});
function endDrawerDrag(event) {
  if (!drag || drag.pointer !== event.pointerId) return;
  const dismiss = event.type === 'pointerup' && event.clientY - drag.y > Math.min(48, drag.height / 3);
  panel(dismiss ? null : activePanel, true);
}
drawerHeader.addEventListener('pointerup', endDrawerDrag);
drawerHeader.addEventListener('pointercancel', endDrawerDrag);
drawerHeader.addEventListener('lostpointercapture', endDrawerDrag);

function editPath(path) {
  const dialog = $('fileDialog');
  $('fileLabel').textContent = path ? 'Rename file' : 'New file path';
  $('fileName').value = path || '';
  dialog.returnValue = '';
  dialog.onclose = () => {
    if (dialog.returnValue !== 'save') return;
    const next = $('fileName').value.trim();
    if (next === path) return;
    if (!validPath(next) || documents.has(next)) {
      status('Use an unused file path, for example src/main.js.');
      panel('files');
      return;
    }
    const doc = path ? documents.get(path) : makeDoc(next, '');
    if (path) {
      documents.delete(path);
      tabs = tabs.map(item => item === path ? next : item);
      doc.modeOption = modes[next.split('.').pop().toLowerCase()] || 'text/plain';
    }
    documents.set(next, doc);
    open(next);
    editor.setOption('mode', modes[next.split('.').pop().toLowerCase()] || 'text/plain');
    panel(null);
  };
  dialog.showModal();
  $('fileName').select();
}
function selectMatch(offset, length) {
  editor.setSelection(editor.posFromIndex(offset), editor.posFromIndex(offset + length));
  editor.scrollIntoView(editor.getCursor());
}
function findNext() {
  const query = $('query').value;
  if (!active || !query) return;
  const text = editor.getValue();
  let offset = text.indexOf(query, editor.indexFromPos(editor.getCursor('to')));
  if (offset < 0) offset = text.indexOf(query);
  if (offset < 0) status('No match in this file');
  else selectMatch(offset, query.length);
}
function suggest() {
  if (active) editor.showHint({hint: CodeMirror.hint.anyword, completeSingle: false});
}
function appearance() {
  const light = $('theme').value === 'default';
  document.body.classList.toggle('light', light);
  editor.setOption('theme', 'hexflow');
  if (typeof AndroidBridge !== 'undefined') AndroidBridge.setLightTheme(light);
  const size = Math.min(28, Math.max(12, Number($('font').value) || 15));
  editor.getWrapperElement().style.fontSize = size + 'px';
  editor.refresh();
  persist();
}
editor.on('cursorActivity', position);
editor.on('change', () => {
  clearTimeout(pendingSave);
  status('Saving…', 'saving');
  pendingSave = setTimeout(persist, 250);
  scheduleCheck();
  queuePreview();
  if (activePanel === 'outline') renderOutline();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
for (const control of document.querySelectorAll('[data-panel]')) {
  control.onclick = () => panel(activePanel === control.dataset.panel ? null : control.dataset.panel);
}
$('openFiles').onclick = () => panel('files');
$('paletteClose').onclick = () => $('commandDialog').close();
$('drawerClose').onclick = () => {
  const selected = document.querySelector('.tools .current');
  panel(null);
  if (selected) selected.focus();
};
window.dismissWorkspaceTools = () => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    dialog.close();
    return true;
  }
  if (!activePanel) return false;
  panel(null);
  return true;
};
for (const control of document.querySelectorAll('[data-text]')) {
  control.onpointerdown = event => event.preventDefault();
  control.onclick = () => { if (active) { editor.replaceSelection(control.dataset.text); editor.focus(); } };
}
$('new').onclick = () => editPath(null);
$('rename').onclick = () => editPath(active);
$('delete').onclick = () => {
  if (!active || !window.confirm('Delete ' + active + '?')) return;
  documents.delete(active);
  tabs = tabs.filter(path => path !== active);
  open(tabs[tabs.length - 1]);
};
$('find').onclick = findNext;
$('query').onkeydown = event => { if (event.key === 'Enter') findNext(); };
$('replace').onclick = () => {
  const query = $('query').value;
  if (!active || !query) return;
  const pieces = editor.getValue().split(query);
  if (pieces.length > 1) editor.replaceRange(pieces.join($('replacement').value), {line: 0, ch: 0},
    {line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length}, '+input');
  persist();
  status('Replaced ' + (pieces.length - 1) + ' matches');
};
$('findProject').onclick = () => {
  const query = $('query').value;
  const results = $('results');
  results.replaceChildren();
  if (!query) return;
  let count = 0;
  for (const [path, doc] of documents) {
    doc.getValue().split('\n').some((line, index) => {
      const ch = line.indexOf(query);
      if (ch >= 0) {
        listItem(results, button(path + ':' + (index + 1) + '  ' + line.trim().slice(0, 90), () => {
          open(path);
          panel(null);
          selectMatch(editor.indexFromPos({line: index, ch}), query.length);
        }));
        count++;
      }
      return count === 100;
    });
    if (count === 100) break;
  }
  status(count === 100 ? 'Showing the first 100 matching lines' : count + ' matching lines');
};
$('indent').onclick = () => { if (active) { editor.execCommand('defaultTab'); editor.focus(); } };
$('undo').onclick = () => { if (active) editor.undo(); };
$('redo').onclick = () => { if (active) editor.redo(); };
$('hint').onclick = suggest;
$('theme').onchange = appearance;
$('font').onchange = appearance;
$('import').onclick = () => AndroidBridge.pickFile();
$('export').onclick = () => AndroidBridge.exportProject(JSON.stringify(contents()));
$('save').onclick = () => { if (active) AndroidBridge.exportFile(active.split('/').pop(), editor.getValue()); };
function updatePreviewEntries() {
  const entries = [...documents.keys()].filter(path => /\.html?$/i.test(path)).sort();
  if (!entries.includes(previewEntry)) previewEntry = entries.includes('index.html') ? 'index.html' : entries[0] || '';
  $('entry').replaceChildren(...(entries.length ? entries : ['']).map(path => {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path || 'No HTML page';
    return option;
  }));
  $('entry').value = previewEntry;
  $('entry').disabled = !previewEntry;
  for (const control of document.querySelectorAll('[data-view]:not([data-view="editor"])')) {
    control.disabled = !previewEntry;
  }
  if (!previewEntry && viewMode !== 'editor') setView('editor');
}
function queuePreview(immediate = false) {
  clearTimeout(previewTimer);
  if (viewMode === 'editor' || !previewEntry) return;
  const update = () => {
    const json = JSON.stringify(contents());
    if (json.length > 2 * 1024 * 1024) {
      setView('editor');
      status('Live Preview supports projects up to 2 MB of text.');
      return;
    }
    const fingerprint = JSON.stringify([viewMode, previewEntry, json]);
    if (fingerprint === lastPreview) return;
    lastPreview = fingerprint;
    AndroidBridge.preview(previewEntry, json, viewMode === 'split');
  };
  if (immediate) update();
  else previewTimer = setTimeout(update, 420);
}
function setView(mode, closeNative = true) {
  if (mode !== 'editor' && !previewEntry) {
    status('Add an HTML file before opening Live Preview.');
    return;
  }
  viewMode = mode;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === mode));
  }
  if (mode === 'editor') {
    clearTimeout(previewTimer);
    lastPreview = '';
    if (closeNative) AndroidBridge.closeViewer();
    editor.refresh();
  } else {
    panel(null);
    queuePreview(true);
  }
}
function runActive() {
  const extension = HexDiagnostics.extension(active);
  if (extension === 'html' || extension === 'htm') {
    previewEntry = active;
    $('entry').value = active;
    persist();
    setView('preview');
    return;
  }
  const runtime = {js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', py: 'python', sql: 'sql'}[extension];
  if (!runtime) {
    status('Run supports HTML, JavaScript, TypeScript, Python and SQL.');
    return;
  }
  const source = editor.getValue();
  if (source.length > 300000) { status('Run supports scripts up to 300,000 characters.'); return; }
  setView('editor');
  persist();
  AndroidBridge.runCode(runtime, source);
}
let highlightedLine;
let highlightTimer;
function highlightDestination(line) {
  clearTimeout(highlightTimer);
  if (highlightedLine) {
    highlightedLine.doc.removeLineClass(highlightedLine.handle, 'background', 'jump-destination');
  }
  const doc = editor.getDoc();
  const handle = doc.addLineClass(line, 'background', 'jump-destination');
  highlightedLine = {doc, handle};
  highlightTimer = setTimeout(() => {
    doc.removeLineClass(handle, 'background', 'jump-destination');
    highlightedLine = null;
  }, 650);
}
function navigateTo(path, line, column = 1) {
  open(path);
  panel(null);
  const position = {line: line - 1, ch: column - 1};
  editor.setCursor(position);
  editor.scrollIntoView(position, 30);
  highlightDestination(editor.getCursor().line);
  editor.focus();
}
function renderOutline() {
  const list = $('symbols');
  list.replaceChildren();
  const matcher = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|def|interface|enum|func|struct|trait|fn|module)\s+([\w$]+)|^(#{1,6}\s+.+)|^\s*<(h[1-6])(?:>|\s)([^<]*)/i;
  let count = 0;
  editor.eachLine(line => {
    const match = matcher.exec(line.text);
    if (!match || count >= 100) return;
    const number = editor.getLineNumber(line) + 1;
    listItem(list, button((match[1] || match[2] || match[4] || match[3]) + '  ·  ' + number,
      () => navigateTo(active, number)));
    count++;
  });
  if (!count) list.textContent = 'No headings or declarations found.';
}
function scheduleCheck() {
  clearTimeout(checkerTimer);
  checkGeneration++;
  editor.clearGutter('diagnostic-gutter');
  $('problemCount').hidden = true;
  $('problemCount').textContent = '';
  $('issues').replaceChildren();
  if (active && $('autoCheck').checked) checkerTimer = setTimeout(() => checkFiles(false), 550);
}
async function checkFiles(project, explicit = false) {
  clearTimeout(checkerTimer);
  const token = ++checkGeneration;
  const files = project ? [...documents] : active ? [[active, editor.getDoc()]] : [];
  let checked = 0;
  let skipped = 0;
  const results = [];
  const selected = active;
  for (const [path, doc] of files) {
    if (token !== checkGeneration) return;
    const text = doc.getValue();
    if (text.length > 300000 || checked >= 60 || !HexDiagnostics.supported.has(HexDiagnostics.extension(path))) {
      skipped++;
      continue;
    }
    try {
      const issues = await HexDiagnostics.inspect(path, text);
      if (issues) {
        checked++;
        results.push(...issues.slice(0, 60).map(issue => ({path, ...issue})));
      }
    } catch (error) {
      skipped++;
    }
  }
  if (token !== checkGeneration) return;
  const list = $('issues');
  list.replaceChildren();
  $('problemCount').hidden = results.length === 0;
  $('problemCount').textContent = String(results.length);
  editor.clearGutter('diagnostic-gutter');
  for (const issue of results.slice(0, 200)) {
    listItem(list, button(issue.path + ':' + issue.line + ':' + issue.column + '  ' + issue.message,
      () => navigateTo(issue.path, issue.line, issue.column)));
    if (issue.path === selected && issue.line <= editor.lineCount()) {
      const marker = document.createElement('span');
      marker.className = 'diagnostic-marker';
      marker.textContent = issue.severity === 'warning' ? '▲' : '●';
      marker.title = issue.message;
      marker.onclick = () => panel('problems');
      editor.setGutterMarker(issue.line - 1, 'diagnostic-gutter', marker);
    }
  }
  const summary = document.createElement('li');
  summary.textContent = checked ? checked + ' checked · ' + results.length + ' reported' :
    active && HexDiagnostics.extension(active) === 'sql' ? 'Run SQL to check it against a temporary SQLite database.' :
    'No checker for the selected file.';
  if (project && skipped) summary.textContent += ' · ' + skipped + ' skipped';
  list.prepend(summary);
  if (explicit) status(summary.textContent);
}
function goToLine() {
  if (!active) return;
  const dialog = $('lineDialog');
  $('lineNumber').max = editor.lineCount();
  $('lineNumber').value = editor.getCursor().line + 1;
  dialog.returnValue = '';
  dialog.onclose = () => {
    if (dialog.returnValue === 'go') navigateTo(active, Number($('lineNumber').value));
  };
  dialog.showModal();
  $('lineNumber').select();
}
function formatJson() {
  if (HexDiagnostics.extension(active) !== 'json') {
    status('Format is currently available for JSON.');
    return;
  }
  try {
    const formatted = JSON.stringify(JSON.parse(editor.getValue()), null, 2) + '\n';
    const end = editor.lastLine();
    editor.replaceRange(formatted, {line: 0, ch: 0}, {line: end, ch: editor.getLine(end).length}, '+input');
    persist();
  } catch (error) {
    panel('problems');
    checkFiles(false, true);
  }
}
function openPalette() {
  const dialog = $('commandDialog');
  const input = $('commandQuery');
  const actions = [
    ['New file', () => editPath(null)], ['Go to line', goToLine], ['Format JSON', formatJson],
    ['Run current file', runActive], ['Open Live Preview', () => setView('preview')],
    ['Open split view', () => setView('split')], ['Check project', () => { panel('problems'); checkFiles(true, true); }],
    ['Export project ZIP', () => $('export').click()], ['Show outline', () => panel('outline')]
  ];
  for (const path of documents.keys()) actions.push([path, () => { open(path); panel(null); }]);
  function renderCommands() {
    $('commands').replaceChildren();
    const query = input.value.trim().toLowerCase();
    for (const [label, action] of actions.filter(([label]) => label.toLowerCase().includes(query)).slice(0, 50)) {
      listItem($('commands'), button(label, () => { dialog.close(); action(); }));
    }
  }
  input.value = '';
  input.oninput = renderCommands;
  input.onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = $('commands').querySelector('button');
      if (first) first.click();
    }
  };
  renderCommands();
  dialog.showModal();
  input.focus();
}
window.viewerClosed = () => setView('editor', false);
$('entry').onchange = () => { previewEntry = $('entry').value; persist(); queuePreview(true); };
for (const control of document.querySelectorAll('[data-view]')) {
  control.onclick = () => setView(control.dataset.view);
}
$('palette').onclick = openPalette;
$('run').onclick = runActive;
$('check').onclick = () => checkFiles(false, true);
$('checkProject').onclick = () => checkFiles(true, true);
$('autoCheck').checked = previous.autoCheck !== false;
$('autoCheck').onchange = () => { persist(); scheduleCheck(); };
setTimeout(() => { $('splash').hidden = true; }, 1000);
window.importProjectFiles = files => {
  let first;
  let skipped = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!validPath(path) || documents.has(path)) { skipped++; continue; }
    documents.set(path, makeDoc(path, content));
    if (!first) first = path;
  }
  if (first) open(first);
  status(skipped ? 'Skipped ' + skipped + ' duplicate or unsupported paths' :
    first ? 'Import complete' : 'No supported text files found');
};
window.nativeStatus = status;
$('theme').value = previous.theme === 'default' ? 'default' : 'material-darker';
$('font').value = previous.font || '15';
open(previous.active || tabs[0]);
appearance();
