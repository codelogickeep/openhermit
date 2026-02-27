const pty = require('node-pty');

const shell = process.env.SHELL || '/bin/bash';
const cwd = '/Users/zhengyd/OtherProject/testOpenHermit';

console.log('Shell:', shell);
console.log('CWD:', cwd);

try {
  console.log('Attempting to spawn with custom cwd...');
  const child = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: cwd,
    env: process.env
  });

  child.onData((data) => {
    console.log('Data:', data.substring(0, 100));
  });

  child.onExit(({ exitCode, signal }) => {
    console.log('Exit:', exitCode, signal);
  });

  console.log('Spawn successful!');
  child.write('echo hello\r');

  setTimeout(() => {
    child.kill();
    process.exit(0);
  }, 2000);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
