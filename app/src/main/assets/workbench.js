'use strict';

const $ = id => document.getElementById(id);
const storageKey = 'workbench.project.v1';
const example = {
  'index.html': '<!doctype html>\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Workbench demo</title>\n<link rel="stylesheet" href="style.css">\n<h1>Hello, Workbench</h1>\n<button id="demo">Tap to test JavaScript</button>\n<script src="main.js"></script>\n',
  'style.css': 'body { font: 18px system-ui; padding: 24px; color: #153b3b; }\nbutton { padding: 12px; }\n',
  'main.js': "document.querySelector('#demo').onclick = () => {\n  console.log('The app is running.');\n  document.querySelector('h1').textContent = 'It works!';\n};\n"
};
let previous = {};
try { previous = JSON.parse(localStorage.getItem(storageKey)) || {}; }
catch (error) { console.warn(error); }

const documents = new Map();
const modes = {
  html: 'htmlmixed', htm: 'htmlmixed', js: 'javascript', ts: 'text/typescript',
  json: 'application/json', css: 'css', py: 'python', java: 'text/x-java',
  c: 'text/x-csrc', cpp: 'text/x-c++src', md: 'markdown', sh: 'shell',
  sql: 'text/x-sql', xml: 'xml', svg: 'xml', yaml: 'yaml', yml: 'yaml'
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
const blank = makeDoc('empty.txt', '');
const editor = CodeMirror($('editor'), {
  lineNumbers: true, indentUnit: 2, tabSize: 2, lineWrapping: true,
  autoCloseBrackets: true, matchBrackets: true, inputStyle: 'contenteditable',
  extraKeys: {
    'Ctrl-Space': suggest,
    'Ctrl-F': () => { panel('search'); $('query').focus(); },
    'Ctrl-S': () => { persist(); }
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
function status(message) { $('status').textContent = message; }
function persist() {
  clearTimeout(pendingSave);
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      files: contents(), tabs, active, theme: $('theme').value, font: $('font').value
    }));
    status('Saved on this device');
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
function render() {
  $('tree').replaceChildren();
  for (const path of [...documents.keys()].sort()) {
    const item = button(path, () => { open(path); panel(null); });
    if (path === active) item.classList.add('selected');
    listItem($('tree'), item);
  }
  $('tabs').replaceChildren();
  for (const path of tabs) {
    const tab = document.createElement('div');
    tab.className = 'tab';
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
}
function position() {
  const {line, ch} = editor.getCursor();
  $('position').textContent = active ? 'Ln ' + (line + 1) + ', Col ' + (ch + 1) : '';
}
function panel(id) {
  for (const control of document.querySelectorAll('[data-panel]')) {
    const selected = control.dataset.panel === id;
    control.setAttribute('aria-pressed', String(selected));
    $(control.dataset.panel).hidden = !selected;
  }
  editor.refresh();
}
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
  document.body.classList.toggle('light', $('theme').value === 'default');
  editor.setOption('theme', $('theme').value);
  const size = Math.min(28, Math.max(12, Number($('font').value) || 15));
  editor.getWrapperElement().style.fontSize = size + 'px';
  editor.refresh();
  persist();
}
editor.on('cursorActivity', position);
editor.on('change', () => {
  clearTimeout(pendingSave);
  status('Saving…');
  pendingSave = setTimeout(persist, 250);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
for (const control of document.querySelectorAll('[data-panel]')) {
  control.onclick = () => panel($(control.dataset.panel).hidden ? control.dataset.panel : null);
}
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
$('run').onclick = () => {
  const isHtml = path => /\.html?$/i.test(path || '');
  const entry = isHtml(active) ? active : documents.has('index.html') ? 'index.html' : [...documents.keys()].find(isHtml);
  if (!entry) { status('Create an HTML file to run a preview.'); return; }
  persist();
  AndroidBridge.preview(entry, JSON.stringify(contents()));
};
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
