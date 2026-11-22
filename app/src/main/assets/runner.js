'use strict';

const state = document.getElementById('state');
const output = document.getElementById('output');
const stop = document.getElementById('stop');
let worker;
let timeout;
function finish(message) {
  clearTimeout(timeout);
  if (worker) worker.terminate();
  worker = null;
  stop.disabled = true;
  state.textContent = message;
}
stop.onclick = () => finish('Stopped');
window.runCode = (language, source) => {
  output.textContent = '';
  worker = new Worker('runner-worker.js');
  stop.disabled = false;
  state.textContent = 'Running…';
  timeout = setTimeout(() => finish('Stopped after 12 seconds'), 12000);
  worker.onmessage = ({data}) => {
    if (data.kind === 'output') {
      if (output.textContent.length < 24000) output.append(String(data.value).slice(0, 4000));
    } else if (data.kind === 'error') {
      output.append('\n' + String(data.value).slice(0, 4000));
      finish('Execution failed');
    } else if (data.kind === 'done') {
      if (!output.textContent) output.textContent = 'Program exited without output.';
      finish('Finished');
    }
  };
  worker.onerror = event => {
    output.append(event.message);
    finish('Execution failed');
  };
  worker.postMessage({language, source});
};
