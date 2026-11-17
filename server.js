
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer, WebSocket } = require('ws');

const HOST = '127.0.0.1';
const PORT = 3000;
const SHELL = process.env.SHELL || 'bash';

const PUBLIC = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
    const routes = {
        '/': ['index.html', 'text/html'],
        '/style.css': ['style.css', 'text/css'],
        '/app.js': ['app.js', 'application/javascript']
    };

    const route = routes[new URL(req.url, 'http://localhost').pathname];

    if (!route) {
        res.writeHead(404);
        return res.end('Not found');
    }

    fs.readFile(path.join(PUBLIC, route[0]), (err, data) => {
        if (err) {
            res.writeHead(500);
            return res.end('Server error');
        }

        res.writeHead(200, {
            'Content-Type': route[1],
            'X-Content-Type-Options': 'nosniff'
        });

        res.end(data);
    });
});

const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192
});

server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;

    // Prevent other websites from opening a shell session.
    if (origin) {
        const allowed = [
            `http://${HOST}:${PORT}`,
            `http://localhost:${PORT}`
        ];

        if (!allowed.includes(origin)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            return socket.destroy();
        }
    }

    if (req.url !== '/ws') {
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
    });
});

function killShell(shell, signal = 'SIGTERM') {
    if (!shell || shell.killed) return;

    try {
        if (process.platform !== 'win32' && shell.pid) {
            process.kill(-shell.pid, signal);
        } else {
            shell.kill(signal);
        }
    } catch {
        shell.kill(signal);
    }
}

wss.on('connection', ws => {
    if (wss.clients.size > 5) {
        ws.close(1013, 'Too many sessions');
        return;
    }

    const shell = spawn(
        SHELL,
        ['--noprofile', '--norc'],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                PS1: '\\u@\\h:\\w\\$ '
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: process.platform !== 'win32'
        }
    );

    let closed = false;

    function send(type, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, data }));
        }
    }

    send('ready', {
        shell: SHELL,
        pid: shell.pid,
        cwd: process.cwd()
    });

    shell.stdout.on('data', data => {
        send('output', data.toString());
    });

    shell.stderr.on('data', data => {
        send('output', data.toString());
    });

    shell.on('error', error => {
        send('error', error.message);
    });

    shell.on('close', (code, signal) => {
        send('exit', { code, signal });
        closed = true;

        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });

    ws.on('message', message => {
        if (closed) return;

        try {
            const packet = JSON.parse(message.toString());

            switch (packet.type) {
                case 'command': {
                    if (typeof packet.data !== 'string') return;
                    if (packet.data.length > 4096) return;

                    shell.stdin.write(packet.data + '\n');
                    break;
                }

                case 'interrupt': {
                    // Interrupt the shell process group and its children.
                    killShell(shell, 'SIGINT');
                    break;
                }

                case 'eof': {
                    shell.stdin.end();
                    break;
                }
            }
        } catch {
            send('error', 'Invalid WebSocket message');
        }
    });

    ws.on('close', () => {
        closed = true;
        killShell(shell);
    });

    ws.on('error', () => {
        closed = true;
        killShell(shell);
    });
});

server.listen(PORT, HOST, () => {
    console.log('================================');
    console.log(' Node Webshell');
    console.log('================================');
    console.log(` HTTP:      http://${HOST}:${PORT}`);
    console.log(` WebSocket: ws://${HOST}:${PORT}/ws`);
    console.log(` Shell:     ${SHELL}`);
});

