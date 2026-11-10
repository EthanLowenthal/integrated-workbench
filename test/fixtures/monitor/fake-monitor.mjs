// Fake pluggable monitor for tests. Speaks the same protocol as arduino/serial-monitor
// (pretty-printed JSON replies, data over a TCP connection back to the client).
// Ports: /dev/fail -> OPEN error; /dev/vanish -> port_closed after 200 ms; anything else -> echo.
import net from 'node:net';
import readline from 'node:readline';
const silent = process.env.FAKE_SILENT === '1';
const say = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
let sock;
let baud = '9600';
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (silent) return;
  const [cmd, ...args] = line.trim().split(' ');
  if (cmd === 'HELLO') say({ eventType: 'hello', message: 'OK', protocolVersion: 1 });
  else if (cmd === 'DESCRIBE')
    say({
      eventType: 'describe',
      message: 'OK',
      port_description: {
        protocol: 'serial',
        configuration_parameters: { baudrate: { label: 'Baudrate', type: 'enum', value: ['9600', '115200'], selected: baud } },
      },
    });
  else if (cmd === 'CONFIGURE') {
    baud = args[1];
    say({ eventType: 'configure', message: 'OK' });
    sock?.write(`baud=${baud}\n`);
  } else if (cmd === 'OPEN') {
    const [host, port] = args[0].split(':');
    const path = args[1];
    if (path === '/dev/fail') return say({ eventType: 'open', message: 'Invalid serial port', error: true });
    sock = net.connect(Number(port), host, () => {
      say({ eventType: 'open', message: 'OK' });
      sock.write(`hello from ${path} at ${baud}\n`);
      if (path === '/dev/vanish') setTimeout(() => {
        say({ eventType: 'port_closed', message: 'serial port disappeared!' });
        sock.end();
      }, 200);
    });
    sock.on('data', (d) => sock.write(`echo:${d.toString().toUpperCase()}`));
  } else if (cmd === 'CLOSE') {
    sock?.end();
    say({ eventType: 'close', message: 'OK' });
  } else if (cmd === 'QUIT') {
    say({ eventType: 'quit', message: 'OK' });
    process.exit(0);
  }
});
